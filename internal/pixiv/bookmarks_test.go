package pixiv

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/state"
)

func TestSaveBookmarkFields(t *testing.T) {
	public, private := pixivgo.RestrictPublic, pixivgo.RestrictPrivate
	empty, replacement := []string{}, []string{" 猫 ", "猫", "", "风景", "Case", "case"}
	for _, tt := range []struct {
		name                   string
		bookmarked             bool
		update                 BookmarkUpdate
		wantRestrict, wantTags string
	}{
		{"omitted preserves", true, BookmarkUpdate{}, "private", "猫 old"},
		{"visibility preserves tags", true, BookmarkUpdate{Restrict: &public}, "public", "猫 old"},
		{"empty clears", true, BookmarkUpdate{Tags: &empty}, "private", ""},
		{"replacement preserves visibility", true, BookmarkUpdate{Tags: &replacement}, "private", "猫 风景 Case case"},
		{"explicit replacement", true, BookmarkUpdate{Restrict: &private, Tags: &replacement}, "private", "猫 风景 Case case"},
		{"new defaults public", false, BookmarkUpdate{}, "public", ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var got url.Values
			srv := routeServer(t, map[string]http.HandlerFunc{
				"/v2/illust/bookmark/detail": func(w http.ResponseWriter, _ *http.Request) {
					fmt.Fprintf(w, `{"bookmark_detail":{"is_bookmarked":%t,"restrict":"private","tags":[{"name":"猫","is_registered":true},{"name":"suggestion","is_registered":false},{"name":"old","is_registered":true}]}}`, tt.bookmarked)
				},
				"/v2/illust/bookmark/add": func(w http.ResponseWriter, r *http.Request) {
					if err := r.ParseForm(); err != nil {
						t.Error(err)
					}
					got = r.PostForm
					w.Write([]byte(`{}`))
				},
			})
			svc := newTestService(t, config.PixivConfig{})
			seedStaleAuth(t, svc, srv)
			if err := svc.SaveBookmark(context.Background(), 42, tt.update); err != nil {
				t.Fatal(err)
			}
			if !got.Has("tags[]") || got.Get("tags[]") != tt.wantTags || got.Get("restrict") != tt.wantRestrict {
				t.Fatalf("got %v, want restrict=%s tags=%q (present)", got, tt.wantRestrict, tt.wantTags)
			}
		})
	}
}

func TestSaveBookmarkReadFailureDoesNotWrite(t *testing.T) {
	var writes atomic.Int32
	srv := routeServer(t, map[string]http.HandlerFunc{
		"/v2/illust/bookmark/detail": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) },
		"/v2/illust/bookmark/add":    func(w http.ResponseWriter, _ *http.Request) { writes.Add(1) },
	})
	svc := newTestService(t, config.PixivConfig{})
	seedStaleAuth(t, svc, srv)
	if err := svc.SaveBookmark(context.Background(), 42, BookmarkUpdate{}); err == nil {
		t.Fatal("expected read failure")
	}
	if writes.Load() != 0 {
		t.Fatal("failed read must never write defaults")
	}
}

func TestBookmarkRetryOnlyAuthentication(t *testing.T) {
	for _, status := range []int{401, 500} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var writes, refresh atomic.Int32
			srv := routeServer(t, map[string]http.HandlerFunc{
				"/auth/token": freshToken(&refresh),
				"/v2/illust/bookmark/add": func(w http.ResponseWriter, r *http.Request) {
					writes.Add(1)
					if status == 401 && r.Header.Get("Authorization") == "Bearer at2" {
						w.Write([]byte(`{}`))
						return
					}
					w.WriteHeader(status)
				},
			})
			svc := newTestService(t, config.PixivConfig{})
			seedStaleAuth(t, svc, srv)
			restrict, tags := pixivgo.RestrictPublic, []string{}
			err := svc.SaveBookmark(context.Background(), 42, BookmarkUpdate{Restrict: &restrict, Tags: &tags})
			if status == 401 {
				if err != nil || writes.Load() != 2 || refresh.Load() != 1 {
					t.Fatalf("auth retry: err=%v writes=%d refresh=%d", err, writes.Load(), refresh.Load())
				}
			} else if err == nil || writes.Load() != 1 || refresh.Load() != 0 {
				t.Fatalf("network failure must not replay: err=%v writes=%d", err, writes.Load())
			}
		})
	}
}

func TestBookmarkLockCancellationAndCleanup(t *testing.T) {
	var locks bookmarkLocks
	key := bookmarkKey{1, 42}
	release, err := locks.acquire(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := locks.acquire(ctx, key); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
	// Another artwork can proceed independently, including during a held lock.
	other, err := locks.acquire(context.Background(), bookmarkKey{1, 43})
	if err != nil {
		t.Fatal(err)
	}
	other()
	release()
	if len(locks.entries) != 0 {
		t.Fatalf("locks leaked: %v", locks.entries)
	}
}

func TestBookmarkSerializesReadWriteAndDelete(t *testing.T) {
	svc := newTestService(t, config.PixivConfig{})
	entered, unblock := make(chan struct{}), make(chan struct{})
	var deletes atomic.Int32
	srv := routeServer(t, map[string]http.HandlerFunc{
		"/v2/illust/bookmark/detail": func(w http.ResponseWriter, _ *http.Request) {
			close(entered)
			<-unblock
			w.Write([]byte(`{"bookmark_detail":{"is_bookmarked":true,"restrict":"private","tags":[]}}`))
		},
		"/v1/illust/bookmark/delete": func(w http.ResponseWriter, _ *http.Request) { deletes.Add(1); w.Write([]byte(`{}`)) },
	})
	seedStaleAuth(t, svc, srv)
	done := make(chan error, 1)
	go func() { _, err := svc.BookmarkDetail(context.Background(), 42); done <- err }()
	<-entered
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := svc.DeleteBookmark(ctx, 42); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled queued delete: %v", err)
	}
	if deletes.Load() != 0 {
		t.Fatal("delete bypassed artwork lock")
	}
	close(unblock)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteBookmark(context.Background(), 42); err != nil {
		t.Fatal(err)
	}
	if deletes.Load() != 1 {
		t.Fatal("delete did not proceed after read")
	}
}

func TestNormalizeBookmarkTags(t *testing.T) {
	for _, tags := range [][]string{{"two words"}, {"中\u3000文"}, strings.Split("a,b,c,d,e,f,g,h,i,j,k", ",")} {
		if _, err := NormalizeBookmarkTags(tags); !errors.Is(err, ErrInvalidBookmarkTags) {
			t.Fatalf("accepted %q", tags)
		}
	}
	got, err := NormalizeBookmarkTags([]string{"", " \t", "猫", " 猫 ", "A", "a", "花&鳥/+"})
	if err != nil || strings.Join(got, ",") != "猫,A,a,花&鳥/+" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestBookmarkPinsIdentityAcrossLogin(t *testing.T) {
	for _, rejected := range []bool{false, true} {
		t.Run(fmt.Sprint(rejected), func(t *testing.T) {
			svc := newTestService(t, config.PixivConfig{})
			var writes atomic.Int32
			srv := routeServer(t, map[string]http.HandlerFunc{
				"/v2/illust/bookmark/detail": func(w http.ResponseWriter, r *http.Request) {
					if r.Header.Get("Authorization") != "Bearer at1" {
						t.Error("initial read changed identity")
					}
					// Simulate a login publish during the preservation read.
					svc.refreshMu.Lock()
					svc.mu.Lock()
					svc.token = state.Token{AccessToken: "new-account", RefreshToken: "new-refresh", UserID: 2}
					svc.mu.Unlock()
					svc.Client().SetAuth("new-account", "new-refresh")
					svc.refreshMu.Unlock()
					if rejected {
						w.WriteHeader(401)
						return
					}
					w.Write([]byte(`{"bookmark_detail":{"is_bookmarked":true,"restrict":"private","tags":[]}}`))
				},
				"/v2/illust/bookmark/add": func(w http.ResponseWriter, r *http.Request) {
					writes.Add(1)
					if r.Header.Get("Authorization") != "Bearer at1" {
						t.Error("write escaped pinned account")
					}
					w.Write([]byte(`{}`))
				},
			})
			seedStaleAuth(t, svc, srv)
			svc.token.UserID = 1
			err := svc.SaveBookmark(context.Background(), 42, BookmarkUpdate{})
			if rejected {
				if err == nil || writes.Load() != 0 {
					t.Fatalf("401 must not retry after switch: err=%v writes=%d", err, writes.Load())
				}
			} else if err != nil || writes.Load() != 1 {
				t.Fatalf("same pinned account: err=%v writes=%d", err, writes.Load())
			}
		})
	}
}
