package pixiv

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/state"
)

func newTestService(t *testing.T, cfg config.PixivConfig) *Service {
	t.Helper()
	store := state.NewStore(filepath.Join(t.TempDir(), "state.json"))
	svc, err := NewService(cfg, slog.New(slog.DiscardHandler), store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

// Any HTTP response — even a 404 — proves the network path works, so the probe
// must report reachable regardless of status code.
func TestProbeReachable_AnyResponseIsReachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	orig := pixivProbeURL
	pixivProbeURL = srv.URL
	defer func() { pixivProbeURL = orig }()

	svc := newTestService(t, config.PixivConfig{})
	reachable, _, err := svc.ProbeReachable(context.Background(), nil)
	if err != nil {
		t.Fatalf("ProbeReachable: unexpected error: %v", err)
	}
	if !reachable {
		t.Error("want reachable=true for a 404 response")
	}
}

// A transport-level failure (here: an already-cancelled context) is an expected
// "unreachable" answer, not a fault — reachable=false with a nil error.
func TestProbeReachable_TransportErrorIsUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer srv.Close()

	orig := pixivProbeURL
	pixivProbeURL = srv.URL
	defer func() { pixivProbeURL = orig }()

	svc := newTestService(t, config.PixivConfig{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	reachable, _, err := svc.ProbeReachable(ctx, nil)
	if err != nil {
		t.Fatalf("ProbeReachable: unexpected error: %v", err)
	}
	if reachable {
		t.Error("want reachable=false when the request can't complete")
	}
}

// A proxy override the client can't build is a setup failure (non-nil error),
// distinct from an unreachable host.
func TestProbeReachable_BadProxyOverrideErrors(t *testing.T) {
	svc := newTestService(t, config.PixivConfig{})
	bad := "http://%zz"
	if _, _, err := svc.ProbeReachable(context.Background(), &bad); err == nil {
		t.Error("want an error for an unparseable proxy override")
	}
}
