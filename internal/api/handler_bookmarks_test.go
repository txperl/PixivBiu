package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/pixiv"
	"github.com/txperl/PixivBiu/internal/state"
	"github.com/txperl/pixivgo"
)

func bookmarkHandler(t *testing.T, upstream http.HandlerFunc) http.Handler {
	t.Helper()
	srv := httptest.NewServer(upstream)
	t.Cleanup(srv.Close)
	store := state.NewStore(filepath.Join(t.TempDir(), "state.json"))
	if err := store.Save(state.Token{AccessToken: "test-access", RefreshToken: "test-refresh", UserID: 123}); err != nil {
		t.Fatal(err)
	}
	svc, err := pixiv.NewService(config.PixivConfig{}, slog.New(slog.DiscardHandler), store)
	if err != nil {
		t.Fatal(err)
	}
	pixivgo.WithBaseURL(srv.URL)(svc.Client())
	pixivgo.WithHTTPClient(srv.Client())(svc.Client())
	return HandlerWithOptions(&APIHandler{svc: svc}, ChiServerOptions{})
}

func TestBookmarkRequestValidation(t *testing.T) {
	var calls atomic.Int32
	h := bookmarkHandler(t, func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.Write([]byte(`{}`)) })
	for _, body := range []string{`null`, `[]`, `{"tags":null}`, `{"tags":"猫"}`, `{"tags":["two words"]}`, `{"restrict":null}`, `{"restrict":"unknown"}`, `{} {}`, `{"tags":["a","b","c","d","e","f","g","h","i","j","k"]}`} {
		t.Run(body, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/illusts/42/bookmark", strings.NewReader(body)))
			if w.Code != 400 {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			var wire Error
			if err := json.Unmarshal(w.Body.Bytes(), &wire); err != nil {
				t.Fatal(err)
			}
			if wire.Code != ErrorCodeBadRequest {
				t.Fatalf("wire=%+v", wire)
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatalf("invalid requests reached Pixiv %d times", calls.Load())
	}
}

func TestBookmarkDetailsAndDirectoryWire(t *testing.T) {
	h := bookmarkHandler(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/illust/bookmark/detail":
			w.Write([]byte(`{"bookmark_detail":{"is_bookmarked":true,"restrict":"private","tags":[{"name":"猫","is_registered":true},{"name":"suggestion","is_registered":false}]}}`))
		case "/v1/user/bookmark-tags/illust":
			if r.URL.Query().Get("restrict") != "private" || r.URL.Query().Get("offset") != "30" {
				t.Errorf("query=%v", r.URL.Query())
			}
			w.Write([]byte(`{"bookmark_tags":[{"name":"猫","count":3}],"next_url":"https://app-api.pixiv.net/v1/user/bookmark-tags/illust?offset=60"}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(500)
		}
	})
	for _, tt := range []struct{ path, contains string }{
		{"/illusts/42/bookmark", `"is_registered":false`},
		{"/users/123/bookmark-tags?restrict=private&offset=30", `"next_offset":60`},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tt.path, nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), tt.contains) {
			t.Fatalf("%s: %d %s", tt.path, w.Code, w.Body.String())
		}
	}
	for _, tt := range []struct {
		path   string
		status int
	}{
		{"/users/456/bookmark-tags?restrict=private", 403},
		{"/users/123/bookmark-tags?restrict=invalid", 400},
		{"/users/123/bookmark-tags?offset=-1", 400},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tt.path, nil))
		if w.Code != tt.status {
			t.Fatalf("%s: %d %s", tt.path, w.Code, w.Body.String())
		}
	}
}
