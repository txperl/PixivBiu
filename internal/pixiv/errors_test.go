package pixiv

import (
	"errors"
	"fmt"
	"testing"

	"github.com/txperl/pixivgo"
)

func TestIsInvalidGrant(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"400 invalid_grant", &pixivgo.PixivError{StatusCode: 400, Body: `{"error":"invalid_grant"}`}, true},
		{"401 invalid_grant", &pixivgo.PixivError{StatusCode: 401, Body: `{"error":"invalid_grant","message":"x"}`}, true},
		{"wrapped 400 invalid_grant", fmt.Errorf("refresh: %w", &pixivgo.PixivError{StatusCode: 400, Body: `{"error":"invalid_grant"}`}), true},
		{"400 other error", &pixivgo.PixivError{StatusCode: 400, Body: `{"error":"invalid_request"}`}, false},
		{"500 with invalid_grant body is transient", &pixivgo.PixivError{StatusCode: 500, Body: `invalid_grant`}, false},
		{"429 rate limit", &pixivgo.PixivError{StatusCode: 429, Body: `{"error":"rate_limited"}`}, false},
		{"plain network error", errors.New("dial tcp: connection refused"), false},
		{"auth required sentinel", pixivgo.ErrAuthRequired, false},
		{"nil", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isInvalidGrant(c.err); got != c.want {
				t.Errorf("isInvalidGrant(%v) = %v, want %v", c.err, got, c.want)
			}
		})
	}
}
