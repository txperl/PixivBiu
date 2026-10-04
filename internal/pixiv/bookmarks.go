package pixiv

import (
	"context"
	"errors"
	"strings"
	"sync"
	"unicode"

	"github.com/txperl/pixivgo"
)

var ErrInvalidBookmarkTags = errors.New("bookmark tags cannot be encoded without loss")
var ErrPrivateBookmarkTags = errors.New("private bookmark tags belong to the current account")

// NormalizeBookmarkTags preserves spelling and order. App-API's space-separated
// encoding cannot represent whitespace inside a tag; reject it instead of splitting.
func NormalizeBookmarkTags(tags []string) ([]string, error) {
	next := make([]string, 0, len(tags))
	seen := make(map[string]bool)
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" || seen[tag] {
			continue
		}
		if strings.ContainsFunc(tag, unicode.IsSpace) {
			return nil, ErrInvalidBookmarkTags
		}
		seen[tag] = true
		next = append(next, tag)
	}
	if len(next) > 10 {
		return nil, ErrInvalidBookmarkTags
	}
	return next, nil
}

type BookmarkUpdate struct {
	Restrict *pixivgo.Restrict
	Tags     *[]string
}

type bookmarkKey struct {
	account int64
	illust  int
}
type bookmarkLock struct {
	gate chan struct{}
	refs int
}
type bookmarkLocks struct {
	mu      sync.Mutex
	entries map[bookmarkKey]*bookmarkLock
}

func (l *bookmarkLocks) acquire(ctx context.Context, key bookmarkKey) (func(), error) {
	l.mu.Lock()
	if l.entries == nil {
		l.entries = make(map[bookmarkKey]*bookmarkLock)
	}
	e := l.entries[key]
	if e == nil {
		e = &bookmarkLock{gate: make(chan struct{}, 1)}
		e.gate <- struct{}{}
		l.entries[key] = e
	}
	e.refs++
	l.mu.Unlock()
	drop := func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		e.refs--
		if e.refs == 0 {
			delete(l.entries, key)
		}
	}
	select {
	case <-ctx.Done():
		drop()
		return nil, ctx.Err()
	case <-e.gate:
		return func() { e.gate <- struct{}{}; drop() }, nil
	}
}

// Both the initial attempt and any 401 replay use a pinned client. Login/logout
// cannot change the account halfway through the read/modify/write operation.
func (s *Service) runBookmark(ctx context.Context, id int, fn func(*pixivgo.Client) error) error {
	s.refreshMu.Lock()
	before := s.Snapshot()
	c := s.Client().Clone()
	s.refreshMu.Unlock()
	if before.IsEmpty() {
		return ErrNotAuthenticated
	}
	release, err := s.bookmarks.acquire(ctx, bookmarkKey{before.UserID, id})
	if err != nil {
		return err
	}
	defer release()
	if err := ctx.Err(); err != nil {
		return err
	}
	err = fn(c)
	if err == nil || !isAuthError(err) {
		return err
	}
	pinned, ok := s.refreshForRetry(ctx, before)
	if !ok {
		return err
	}
	c = s.Client().Clone()
	c.SetAuth(pinned.AccessToken, pinned.RefreshToken)
	return fn(c)
}

func (s *Service) SaveBookmark(ctx context.Context, id int, update BookmarkUpdate) error {
	return s.runBookmark(ctx, id, func(c *pixivgo.Client) error {
		restrict := pixivgo.RestrictPublic
		tags := []string{}
		if update.Restrict == nil || update.Tags == nil {
			detail, err := c.IllustBookmarkDetail(ctx, pixivgo.IllustBookmarkDetailParams{IllustID: id})
			if err != nil {
				return err
			}
			if detail.BookmarkDetail.IsBookmarked {
				restrict = pixivgo.Restrict(detail.BookmarkDetail.Restrict)
				for _, tag := range detail.BookmarkDetail.Tags {
					if tag.IsRegistered {
						tags = append(tags, tag.Name)
					}
				}
			}
		}
		if update.Restrict != nil {
			restrict = *update.Restrict
		}
		if update.Tags != nil {
			tags = *update.Tags
		}
		tags, err := NormalizeBookmarkTags(tags)
		if err != nil {
			return err
		}
		return c.IllustBookmarkAdd(ctx, pixivgo.IllustBookmarkAddParams{IllustID: id, Restrict: restrict, Tags: tags})
	})
}

func (s *Service) DeleteBookmark(ctx context.Context, id int) error {
	return s.runBookmark(ctx, id, func(c *pixivgo.Client) error {
		return c.IllustBookmarkDelete(ctx, pixivgo.IllustBookmarkDeleteParams{IllustID: id})
	})
}

func (s *Service) BookmarkDetail(ctx context.Context, id int) (*pixivgo.BookmarkDetailResponse, error) {
	var detail *pixivgo.BookmarkDetailResponse
	err := s.runBookmark(ctx, id, func(c *pixivgo.Client) error {
		var err error
		detail, err = c.IllustBookmarkDetail(ctx, pixivgo.IllustBookmarkDetailParams{IllustID: id})
		return err
	})
	return detail, err
}

// Pin identity and credentials together, including the private-directory check.
func (s *Service) BookmarkTags(ctx context.Context, userID int, restrict pixivgo.Restrict, offset *int) (*pixivgo.UserBookmarkTagsResponse, error) {
	s.refreshMu.Lock()
	before := s.Snapshot()
	c := s.Client().Clone()
	s.refreshMu.Unlock()
	if before.IsEmpty() {
		return nil, ErrNotAuthenticated
	}
	if restrict == pixivgo.RestrictPrivate && (before.UserID == 0 || before.UserID != int64(userID)) {
		return nil, ErrPrivateBookmarkTags
	}
	params := pixivgo.UserBookmarkTagsIllustParams{UserID: userID, Restrict: restrict, Offset: offset}
	resp, err := c.UserBookmarkTagsIllust(ctx, params)
	if err == nil || !isAuthError(err) {
		return resp, err
	}
	pinned, ok := s.refreshForRetry(ctx, before)
	if !ok {
		return resp, err
	}
	c = s.Client().Clone()
	c.SetAuth(pinned.AccessToken, pinned.RefreshToken)
	return c.UserBookmarkTagsIllust(ctx, params)
}
