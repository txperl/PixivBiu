package pixiv

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/state"
)

// routeServer builds an httptest.Server that dispatches by exact request path
// and fails the test on any unexpected path. Both pixivgo's API calls and its
// /auth/token refresh hit the same server (WithBaseURL), so each test wires up
// only the two paths it exercises.
func routeServer(t *testing.T, routes map[string]http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h, ok := routes[r.URL.Path]
		if !ok {
			t.Errorf("unexpected path %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		h(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// seedStaleAuth points the service's pixiv client at the test server (so both
// API calls and the /auth/token refresh hit it) and seeds an expired-looking
// "at1"/"rt1" pair into both the client and the persisted token. With
// WithBaseURL set, pixivgo targets <baseURL>/auth/token for Auth and
// <baseURL>/<path> for everything else (see pixivgo auth.go / client.go).
func seedStaleAuth(t *testing.T, svc *Service, srv *httptest.Server) {
	t.Helper()
	svc.client = pixivgo.NewClient(
		pixivgo.WithBaseURL(srv.URL),
		pixivgo.WithHTTPClient(srv.Client()),
	)
	svc.client.SetAuth("at1", "rt1")
	svc.token = state.Token{AccessToken: "at1", RefreshToken: "rt1"}
}

// freshTokenResponse is the {"response":{...}} envelope pixivgo.Auth expects.
const freshTokenResponse = `{"response":{"refresh_token":"rt2","access_token":"at2","expires_in":3600}}`

// freshToken serves a successful refresh, counting the call.
func freshToken(refreshCount *atomic.Int32) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		refreshCount.Add(1)
		_, _ = w.Write([]byte(freshTokenResponse))
	}
}

// TestCall_RefreshesAndRetriesOn401 is the core self-heal case: an API call
// with the stale token 401s, Call refreshes once and retries with the fresh
// token, which succeeds — no restart needed.
func TestCall_RefreshesAndRetriesOn401(t *testing.T) {
	var refreshCount, apiCount atomic.Int32
	srv := routeServer(t, map[string]http.HandlerFunc{
		"/auth/token": freshToken(&refreshCount),
		"/v1/illust/detail": func(w http.ResponseWriter, r *http.Request) {
			apiCount.Add(1)
			if r.Header.Get("Authorization") == "Bearer at2" {
				_, _ = w.Write([]byte(`{}`))
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
		},
	})

	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)

	resp, err := Call(context.Background(), svc, func(c *pixivgo.Client) (*pixivgo.IllustDetailResponse, error) {
		return c.IllustDetail(context.Background(), pixivgo.IllustDetailParams{IllustID: 1})
	})
	if err != nil {
		t.Fatalf("Call: %v", err)
	}
	if resp == nil {
		t.Fatal("nil response after a successful retry")
	}
	if got := refreshCount.Load(); got != 1 {
		t.Errorf("refreshCount = %d, want 1", got)
	}
	if got := apiCount.Load(); got != 2 {
		t.Errorf("apiCount = %d, want 2 (one 401, one retry)", got)
	}
	if got := svc.Snapshot().AccessToken; got != "at2" {
		t.Errorf("access token = %q, want at2 (refresh must persist)", got)
	}
}

// TestCall_NoRetryWhenRefreshFails guards the invalid_grant path: when the
// refresh itself fails (revoked refresh token), Call must return the original
// 401 and must NOT retry the API call — otherwise a dead refresh token loops.
func TestCall_NoRetryWhenRefreshFails(t *testing.T) {
	var refreshCount, apiCount atomic.Int32
	srv := routeServer(t, map[string]http.HandlerFunc{
		"/auth/token": func(w http.ResponseWriter, _ *http.Request) {
			refreshCount.Add(1)
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		},
		"/v1/illust/detail": func(w http.ResponseWriter, _ *http.Request) {
			apiCount.Add(1)
			w.WriteHeader(http.StatusUnauthorized)
		},
	})

	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)

	_, err := Call(context.Background(), svc, func(c *pixivgo.Client) (*pixivgo.IllustDetailResponse, error) {
		return c.IllustDetail(context.Background(), pixivgo.IllustDetailParams{IllustID: 1})
	})
	if err == nil {
		t.Fatal("expected the original 401, got nil")
	}
	var pe *pixivgo.PixivError
	if !errors.As(err, &pe) || pe.StatusCode != http.StatusUnauthorized {
		t.Fatalf("error = %v, want *pixivgo.PixivError with StatusCode 401", err)
	}
	if got := refreshCount.Load(); got != 1 {
		t.Errorf("refreshCount = %d, want 1", got)
	}
	if got := apiCount.Load(); got != 1 {
		t.Errorf("apiCount = %d, want 1 (no retry after a failed refresh)", got)
	}
}

// TestCall_SingleFlightUnderConcurrent401 proves refreshIfStale collapses a
// stampede: many requests faulting on the same expired token trigger exactly
// one network refresh.
func TestCall_SingleFlightUnderConcurrent401(t *testing.T) {
	var refreshCount, apiCount atomic.Int32
	srv := routeServer(t, map[string]http.HandlerFunc{
		"/auth/token": func(w http.ResponseWriter, _ *http.Request) {
			refreshCount.Add(1)
			time.Sleep(20 * time.Millisecond) // widen the window so a missing lock would race
			_, _ = w.Write([]byte(freshTokenResponse))
		},
		"/v1/illust/detail": func(w http.ResponseWriter, r *http.Request) {
			apiCount.Add(1)
			if r.Header.Get("Authorization") == "Bearer at2" {
				_, _ = w.Write([]byte(`{}`))
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
		},
	})

	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)

	const n = 10
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = Call(context.Background(), svc, func(c *pixivgo.Client) (*pixivgo.IllustDetailResponse, error) {
				return c.IllustDetail(context.Background(), pixivgo.IllustDetailParams{IllustID: 1})
			})
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("goroutine %d: %v", i, err)
		}
	}
	if got := refreshCount.Load(); got != 1 {
		t.Errorf("refreshCount = %d, want 1 (single-flight must collapse the stampede)", got)
	}
}

// TestExec_RetriesPostWithFreshTokenAndBody covers the write path: a POST
// (bookmark add) that 401s is refreshed and retried, and the retried request
// carries both the fresh bearer AND a re-sent body (Option B re-invokes the
// typed method, so pixivgo rebuilds the body — no transport-level replay bug).
func TestExec_RetriesPostWithFreshTokenAndBody(t *testing.T) {
	var refreshCount, apiCount atomic.Int32
	var retriedBody atomic.Value
	srv := routeServer(t, map[string]http.HandlerFunc{
		"/auth/token": freshToken(&refreshCount),
		"/v2/illust/bookmark/add": func(w http.ResponseWriter, r *http.Request) {
			apiCount.Add(1)
			body, _ := io.ReadAll(r.Body)
			if r.Header.Get("Authorization") == "Bearer at2" {
				retriedBody.Store(string(body))
				w.WriteHeader(http.StatusOK)
				return
			}
			w.WriteHeader(http.StatusUnauthorized)
		},
	})

	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)

	err := Exec(context.Background(), svc, func(c *pixivgo.Client) error {
		return c.IllustBookmarkAdd(context.Background(), pixivgo.IllustBookmarkAddParams{
			IllustID: 42,
			Restrict: pixivgo.RestrictPublic,
		})
	})
	if err != nil {
		t.Fatalf("Exec: %v", err)
	}
	if got := refreshCount.Load(); got != 1 {
		t.Errorf("refreshCount = %d, want 1", got)
	}
	if got := apiCount.Load(); got != 2 {
		t.Errorf("apiCount = %d, want 2", got)
	}
	body, _ := retriedBody.Load().(string)
	if !strings.Contains(body, "illust_id=42") {
		t.Errorf("retried POST body = %q, want it to contain illust_id=42", body)
	}
}

// TestRefreshForRetry_IdentityGate covers the auth-identity guard directly (no
// network): a token change is only treated as "already refreshed, retry ok"
// when the identity is unchanged. If a concurrent login/logout/account switch
// changed the identity, refreshForRetry must report false so Call does NOT
// replay the request as the wrong user.
func TestRefreshForRetry_IdentityGate(t *testing.T) {
	before := state.Token{AccessToken: "at1", RefreshToken: "rt1", UserID: 111}

	t.Run("identity changed → no retry", func(t *testing.T) {
		svc := newTestService(t, config.PixivConfig{})
		// A different account is now authenticated (concurrent login/switch).
		svc.token = state.Token{AccessToken: "atB", RefreshToken: "rtB", UserID: 222}
		if _, ok := svc.refreshForRetry(context.Background(), before); ok {
			t.Fatal("refreshForRetry ok = true, want false (identity changed)")
		}
	})

	t.Run("same identity, token already rotated → retry ok", func(t *testing.T) {
		svc := newTestService(t, config.PixivConfig{})
		// Same user, access token already refreshed by another goroutine.
		svc.token = state.Token{AccessToken: "at2", RefreshToken: "rt1", UserID: 111}
		tok, ok := svc.refreshForRetry(context.Background(), before)
		if !ok {
			t.Fatal("refreshForRetry ok = false, want true (same identity already refreshed)")
		}
		if tok.AccessToken != "at2" {
			t.Errorf("pinned token = %q, want at2 (the already-refreshed token)", tok.AccessToken)
		}
	})
}

// TestRefresh_ConcurrentLoginNotClobbered proves refreshMu serializes auth
// mutations: a login that races an in-flight reactive refresh blocks until the
// refresh finishes, then wins — the refresh cannot clobber the new session, and
// the request is not replayed as the previous account.
func TestRefresh_ConcurrentLoginNotClobbered(t *testing.T) {
	authStarted := make(chan struct{})
	releaseAuth := make(chan struct{})
	srv := routeServer(t, map[string]http.HandlerFunc{
		"/auth/token": func(w http.ResponseWriter, r *http.Request) {
			_ = r.ParseForm()
			if r.FormValue("refresh_token") == "rt1" {
				// The reactive refresh of the old session (user 111): signal it
				// is in flight (holding refreshMu) and block until released.
				close(authStarted)
				<-releaseAuth
				_, _ = w.Write([]byte(`{"response":{"refresh_token":"rt1","access_token":"atA2","expires_in":3600,"user":{"id":111}}}`))
				return
			}
			// The login to a different account (user 222).
			_, _ = w.Write([]byte(`{"response":{"refresh_token":"rtB","access_token":"atB","expires_in":3600,"user":{"id":222}}}`))
		},
		"/v1/illust/detail": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusUnauthorized) // always 401 → forces the reactive refresh
		},
	})

	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)
	svc.token.UserID = 111

	reactiveDone := make(chan struct{})
	go func() {
		_, _ = Call(context.Background(), svc, func(c *pixivgo.Client) (*pixivgo.IllustDetailResponse, error) {
			return c.IllustDetail(context.Background(), pixivgo.IllustDetailParams{IllustID: 1})
		})
		close(reactiveDone)
	}()
	<-authStarted // reactive refresh now holds refreshMu

	loginDone := make(chan error, 1)
	go func() {
		_, err := svc.Login(context.Background(), "rtB")
		loginDone <- err
	}()

	// Login must block while the refresh holds refreshMu.
	select {
	case <-loginDone:
		t.Fatal("Login completed while a refresh held refreshMu — not serialized")
	case <-time.After(50 * time.Millisecond):
	}

	close(releaseAuth) // let the reactive refresh finish (publishes user 111)
	<-reactiveDone
	if err := <-loginDone; err != nil {
		t.Fatalf("Login: %v", err)
	}

	// Login ran after the refresh released the lock, so it owns the session.
	if got := svc.Snapshot().UserID; got != 222 {
		t.Errorf("UserID = %d, want 222 (login must not be clobbered by the in-flight refresh)", got)
	}
}

// TestCall_NonAuthErrorNotRetried makes sure a non-401 upstream failure is
// surfaced immediately, with no spurious refresh.
func TestCall_NonAuthErrorNotRetried(t *testing.T) {
	var refreshCount, apiCount atomic.Int32
	srv := routeServer(t, map[string]http.HandlerFunc{
		"/auth/token": freshToken(&refreshCount),
		"/v1/illust/detail": func(w http.ResponseWriter, _ *http.Request) {
			apiCount.Add(1)
			w.WriteHeader(http.StatusInternalServerError)
		},
	})

	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)

	_, err := Call(context.Background(), svc, func(c *pixivgo.Client) (*pixivgo.IllustDetailResponse, error) {
		return c.IllustDetail(context.Background(), pixivgo.IllustDetailParams{IllustID: 1})
	})
	if err == nil {
		t.Fatal("expected the upstream 500 error")
	}
	if got := refreshCount.Load(); got != 0 {
		t.Errorf("refreshCount = %d, want 0 (500 is not an auth error)", got)
	}
	if got := apiCount.Load(); got != 1 {
		t.Errorf("apiCount = %d, want 1 (no retry)", got)
	}
}
