package pixiv

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/state"
)

func TestReload_RebuildsClientPreservingToken(t *testing.T) {
	store := state.NewStore(filepath.Join(t.TempDir(), "state.json"))
	if err := store.Save(state.Token{AccessToken: "at", RefreshToken: "rt"}); err != nil {
		t.Fatalf("seed token: %v", err)
	}
	svc, err := NewService(config.PixivConfig{Proxy: "http://a:1"}, slog.New(slog.DiscardHandler), store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	before := svc.Client()
	if err := svc.Reload(config.PixivConfig{Proxy: "http://b:2"}); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if svc.Client() == before {
		t.Error("client not rebuilt after proxy change")
	}
	if !svc.Authenticated() {
		t.Error("auth token lost across reload")
	}
}

// TestRefresh_StripsMonotonicReading guards the macOS sleep fix: the stored
// access-token expiry must be a pure wall-clock instant (no monotonic reading),
// otherwise time.Until() over-estimates the remaining lifetime after the machine
// sleeps and the refresh loop skips a needed refresh. A time.Time that still
// carries a monotonic reading is not == to its Round(0); equality proves the
// reading was stripped at refresh.go's construction site.
func TestRefresh_StripsMonotonicReading(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// pixivgo.Auth expects the {"response": {...}} wrapper.
		_, _ = w.Write([]byte(`{"response":{"refresh_token":"rt2","access_token":"at2","expires_in":3600}}`))
	}))
	t.Cleanup(srv.Close)

	svc := newTestService(t, config.PixivConfig{})
	// Point the pixivgo client's auth endpoint at the fake server: WithBaseURL
	// makes Auth target <baseURL>/auth/token instead of the real Pixiv host.
	svc.client = pixivgo.NewClient(
		pixivgo.WithBaseURL(srv.URL),
		pixivgo.WithHTTPClient(srv.Client()),
	)

	tok, err := svc.Login(context.Background(), "rt1")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	if tok.AccessTokenExpiresAt != tok.AccessTokenExpiresAt.Round(0) {
		t.Errorf("returned expiry still carries a monotonic reading: %v", tok.AccessTokenExpiresAt)
	}
	if got := svc.Snapshot().AccessTokenExpiresAt; got != got.Round(0) {
		t.Errorf("snapshot expiry still carries a monotonic reading: %v", got)
	}
}

func TestReload_NoChangeIsNoOp(t *testing.T) {
	svc := newTestService(t, config.PixivConfig{Proxy: "http://a:1"})
	before := svc.Client()
	if err := svc.Reload(config.PixivConfig{Proxy: "http://a:1"}); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if svc.Client() != before {
		t.Error("client needlessly rebuilt when proxy unchanged")
	}
}

func TestReload_BadProxyKeepsOldClient(t *testing.T) {
	svc := newTestService(t, config.PixivConfig{})
	before := svc.Client()
	if err := svc.Reload(config.PixivConfig{Proxy: "http://%zz"}); err == nil {
		t.Fatal("expected error for invalid proxy URL")
	}
	if svc.Client() != before {
		t.Error("client swapped despite a failed reload")
	}
}

// invalidGrantToken serves Pixiv's revoked-refresh-token response.
func invalidGrantToken(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusBadRequest)
	_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
}

// TestStart_InvalidGrantClearsSession: a refresh token Pixiv rejects at boot
// must clear the session (in-memory + on-disk) and flag it expired, so the user
// lands on login with a "session expired" hint rather than carrying a dead token.
func TestStart_InvalidGrantClearsSession(t *testing.T) {
	srv := routeServer(t, map[string]http.HandlerFunc{"/auth/token": invalidGrantToken})
	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)
	if err := svc.store.Save(svc.token); err != nil {
		t.Fatalf("seed store: %v", err)
	}

	svc.Start(context.Background())
	defer svc.Shutdown()

	if svc.Authenticated() {
		t.Error("Authenticated = true after invalid_grant on Start, want false")
	}
	if !svc.SessionExpired() {
		t.Error("SessionExpired = false after invalid_grant on Start, want true")
	}
	tok, err := svc.store.Load()
	if err != nil {
		t.Fatalf("store.Load: %v", err)
	}
	if !tok.IsEmpty() {
		t.Errorf("state file not cleared after invalid_grant: %+v", tok)
	}
}

// TestStart_TransientErrorKeepsSession: a transient boot failure (5xx/network)
// must NOT log the user out — the refresh token is still a usable session.
func TestStart_TransientErrorKeepsSession(t *testing.T) {
	srv := routeServer(t, map[string]http.HandlerFunc{
		"/auth/token": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable) // 503: not a token rejection
		},
	})
	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)

	svc.Start(context.Background())
	defer svc.Shutdown()

	if !svc.Authenticated() {
		t.Error("Authenticated = false after a transient Start failure, want true (session retained)")
	}
	if svc.SessionExpired() {
		t.Error("SessionExpired = true after a transient failure, want false")
	}
	if got := svc.Snapshot().RefreshToken; got != "rt1" {
		t.Errorf("refresh token = %q, want rt1 (retained)", got)
	}
}

// TestStart_SkipsRefreshWhenAccessTokenValid: a still-valid access token must
// make Start skip the boot refresh, so merely launching no longer rewrites the
// expiry (and boot isn't blocked on Pixiv).
func TestStart_SkipsRefreshWhenAccessTokenValid(t *testing.T) {
	var refreshCount atomic.Int32
	srv := routeServer(t, map[string]http.HandlerFunc{"/auth/token": freshToken(&refreshCount)})
	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)
	exp := time.Now().Add(30 * time.Minute).Round(0)
	svc.token.AccessTokenExpiresAt = exp

	svc.Start(context.Background())
	defer svc.Shutdown()

	if got := refreshCount.Load(); got != 0 {
		t.Errorf("refreshCount = %d, want 0 (Start must skip refresh for a valid token)", got)
	}
	snap := svc.Snapshot()
	if snap.AccessToken != "at1" || !snap.AccessTokenExpiresAt.Equal(exp) {
		t.Errorf("token changed on Start: got {%q, %v}, want {at1, %v}", snap.AccessToken, snap.AccessTokenExpiresAt, exp)
	}
}

func TestAuthenticated_ReflectsRefreshToken(t *testing.T) {
	cases := []struct {
		name string
		tok  state.Token
		want bool
	}{
		{"refresh + access", state.Token{AccessToken: "at", RefreshToken: "rt"}, true},
		{"refresh only (access expired/dropped)", state.Token{RefreshToken: "rt"}, true},
		{"access only, no refresh", state.Token{AccessToken: "at"}, false},
		{"empty", state.Token{}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svc := newTestService(t, config.PixivConfig{})
			svc.token = c.tok
			if got := svc.Authenticated(); got != c.want {
				t.Errorf("Authenticated() = %v, want %v", got, c.want)
			}
		})
	}
}

func TestNeedsInitialRefresh(t *testing.T) {
	cases := []struct {
		name string
		tok  state.Token
		want bool
	}{
		{"no access token", state.Token{RefreshToken: "rt"}, true},
		{"zero expiry", state.Token{AccessToken: "at", RefreshToken: "rt"}, true},
		{"comfortably valid", state.Token{AccessToken: "at", RefreshToken: "rt", AccessTokenExpiresAt: time.Now().Add(30 * time.Minute)}, false},
		{"near expiry", state.Token{AccessToken: "at", RefreshToken: "rt", AccessTokenExpiresAt: time.Now().Add(2 * time.Minute)}, true},
		{"already expired", state.Token{AccessToken: "at", RefreshToken: "rt", AccessTokenExpiresAt: time.Now().Add(-time.Hour)}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := needsInitialRefresh(c.tok); got != c.want {
				t.Errorf("needsInitialRefresh() = %v, want %v", got, c.want)
			}
		})
	}
}

// TestSessionExpired_ResetOnSuccessfulRefresh: a fresh login supersedes any
// prior expiry flag, so a re-login clears the "session expired" hint.
func TestSessionExpired_ResetOnSuccessfulRefresh(t *testing.T) {
	var refreshCount atomic.Int32
	srv := routeServer(t, map[string]http.HandlerFunc{"/auth/token": freshToken(&refreshCount)})
	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)
	svc.sessionExpired = true // simulate a prior expiry

	if _, err := svc.Login(context.Background(), "rt1"); err != nil {
		t.Fatalf("Login: %v", err)
	}
	if svc.SessionExpired() {
		t.Error("SessionExpired = true after a successful login, want false (reset)")
	}
	if !svc.Authenticated() {
		t.Error("Authenticated = false after a successful login, want true")
	}
}

// TestRefreshCurrent_InvalidGrantClears exercises the loop's path: on
// invalid_grant it clears the session (so the loop's RefreshToken=="" guard
// stops further attempts) and propagates the error, which the loop ignores.
func TestRefreshCurrent_InvalidGrantClears(t *testing.T) {
	srv := routeServer(t, map[string]http.HandlerFunc{"/auth/token": invalidGrantToken})
	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)

	if _, err := svc.refreshCurrent(context.Background()); err == nil {
		t.Error("refreshCurrent err = nil, want the propagated invalid_grant error")
	}
	if svc.Authenticated() {
		t.Error("Authenticated = true after invalid_grant in loop path, want false")
	}
	if !svc.SessionExpired() {
		t.Error("SessionExpired = false after invalid_grant in loop path, want true")
	}
}
