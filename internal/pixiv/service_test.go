package pixiv

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

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
