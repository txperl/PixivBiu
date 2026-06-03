package pixiv

import (
	"context"
	"errors"
	"net/http"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/state"
)

// Call runs fn against the pixiv client and, on an auth error (expired access
// token — pixivgo's ErrAuthRequired or a *pixivgo.PixivError 401), refreshes
// once and retries fn exactly once, self-healing without a restart.
//
// The retry runs on a private Clone pinned to the refreshed same-identity token,
// so a concurrent login/logout can't make the replay run as the wrong account,
// and no lock is held across it. Identity changed, or refresh failed → no retry.
func Call[T any](ctx context.Context, s *Service, fn func(*pixivgo.Client) (T, error)) (T, error) {
	before := s.Snapshot()
	v, err := fn(s.Client())
	if err == nil || !isAuthError(err) {
		return v, err
	}
	pinned, ok := s.refreshForRetry(ctx, before)
	if !ok {
		return v, err
	}
	c := s.Client().Clone()
	c.SetAuth(pinned.AccessToken, pinned.RefreshToken)
	return fn(c)
}

// Exec is the no-value sibling of Call for write calls (bookmark / follow
// add+delete) whose pixivgo method returns only an error.
func Exec(ctx context.Context, s *Service, fn func(*pixivgo.Client) error) error {
	_, err := Call(ctx, s, func(c *pixivgo.Client) (struct{}, error) {
		return struct{}{}, fn(c)
	})
	return err
}

// isAuthError reports whether err is a token rejection a refresh can fix:
// pixivgo's ErrAuthRequired (no token) or a Pixiv HTTP 401.
func isAuthError(err error) bool {
	if errors.Is(err, pixivgo.ErrAuthRequired) {
		return true
	}
	if pe, ok := errors.AsType[*pixivgo.PixivError](err); ok {
		return pe.StatusCode == http.StatusUnauthorized
	}
	return false
}

// refreshForRetry returns a fresh same-identity token to pin for the retry, or
// ({}, false) if the identity changed (login/logout) or the refresh failed —
// then the caller must not replay. Single-flighted by refreshMu, which also
// serializes Login/Logout, so the UserID check below can't race a switch.
func (s *Service) refreshForRetry(ctx context.Context, before state.Token) (state.Token, bool) {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()
	cur := s.Snapshot()
	if cur.UserID != before.UserID {
		return state.Token{}, false // identity changed — not our session
	}
	if cur.AccessToken != before.AccessToken {
		return cur, true // another goroutine already refreshed the same identity
	}
	if cur.RefreshToken == "" {
		return state.Token{}, false
	}
	tok, err := s.refreshLocked(ctx, cur.RefreshToken)
	if err != nil {
		return state.Token{}, false
	}
	return tok, true
}
