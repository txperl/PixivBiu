package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/pixiv"
	"github.com/txperl/PixivBiu/internal/state"
)

// authedService builds a pixiv.Service whose state file already holds a
// token, so Authenticated() is true without any network round-trip.
func authedService(t *testing.T) *pixiv.Service {
	t.Helper()
	store := state.NewStore(filepath.Join(t.TempDir(), "state.json"))
	if err := store.Save(state.Token{AccessToken: "at", RefreshToken: "rt"}); err != nil {
		t.Fatalf("seed token: %v", err)
	}
	svc, err := pixiv.NewService(config.PixivConfig{}, slog.New(slog.DiscardHandler), store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func TestRestartConfig_TriggersRestartWhenAuthed(t *testing.T) {
	var fired int
	// hub/dl/pkce/heartbeat/cfgMgr are unused by RestartConfig.
	h := NewHandler(authedService(t), nil, nil, nil, nil, nil, nil, func() { fired++ })

	rec := httptest.NewRecorder()
	h.RestartConfig(rec, httptest.NewRequest(http.MethodPost, "/config/restart", nil))

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	var body ConfigRestartAccepted
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Status != "restarting" {
		t.Errorf("status field = %q, want restarting", body.Status)
	}
	if fired != 1 {
		t.Errorf("restart trigger fired %d times, want 1", fired)
	}
}

func TestRestartConfig_RequiresAuth(t *testing.T) {
	store := state.NewStore(filepath.Join(t.TempDir(), "state.json"))
	svc, err := pixiv.NewService(config.PixivConfig{}, slog.New(slog.DiscardHandler), store)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	var fired int
	h := NewHandler(svc, nil, nil, nil, nil, nil, nil, func() { fired++ })

	rec := httptest.NewRecorder()
	h.RestartConfig(rec, httptest.NewRequest(http.MethodPost, "/config/restart", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if fired != 0 {
		t.Error("restart trigger fired on an unauthenticated request")
	}
}
