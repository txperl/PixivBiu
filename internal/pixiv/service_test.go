package pixiv

import (
	"log/slog"
	"path/filepath"
	"testing"

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

func TestReload_NoChangeIsNoOp(t *testing.T) {
	store := state.NewStore(filepath.Join(t.TempDir(), "state.json"))
	svc, err := NewService(config.PixivConfig{Proxy: "http://a:1"}, slog.New(slog.DiscardHandler), store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	before := svc.Client()
	if err := svc.Reload(config.PixivConfig{Proxy: "http://a:1"}); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if svc.Client() != before {
		t.Error("client needlessly rebuilt when proxy unchanged")
	}
}

func TestReload_BadProxyKeepsOldClient(t *testing.T) {
	store := state.NewStore(filepath.Join(t.TempDir(), "state.json"))
	svc, err := NewService(config.PixivConfig{}, slog.New(slog.DiscardHandler), store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	before := svc.Client()
	if err := svc.Reload(config.PixivConfig{Proxy: "http://%zz"}); err == nil {
		t.Fatal("expected error for invalid proxy URL")
	}
	if svc.Client() != before {
		t.Error("client swapped despite a failed reload")
	}
}
