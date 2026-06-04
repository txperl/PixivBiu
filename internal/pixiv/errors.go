package pixiv

import (
	"errors"
	"net/http"
	"strings"

	"github.com/txperl/pixivgo"
)

// ErrNotAuthenticated is returned by service calls when no usable access token
// is present. Handlers should translate this into HTTP 401.
var ErrNotAuthenticated = errors.New("pixiv: not authenticated")

// ErrNoRefreshToken is returned when a caller asked to authenticate but no
// refresh token is available (neither supplied nor present in state).
var ErrNoRefreshToken = errors.New("pixiv: no refresh_token")

// ErrNoAuthCode is returned when the OAuth exchange handler is called with
// an empty authorization code (or a URL that doesn't contain one).
var ErrNoAuthCode = errors.New("pixiv: no authorization code")

// isInvalidGrant reports whether err is a *permanent* refresh-token rejection
// (revoked / expired refresh token, password change) — the only failure that
// should clear the session and force re-login. Transient failures (network,
// timeout, 5xx) return false so the caller keeps the session and retries.
//
// Pixiv's OAuth token endpoint answers a dead refresh token with HTTP 400 and a
// body of {"error":"invalid_grant", ...}; we also treat a token-endpoint 401 as
// permanent. The substring match mirrors internal/api/errors.go::classifyPixivBody
// — the payload is a short JSON document and "invalid_grant" doesn't appear in
// other Pixiv error shapes. pixivgo's Auth populates PixivError.Body with the
// raw response on a non-2xx, so the body is available here (errors.As unwraps
// through any wrapping).
func isInvalidGrant(err error) bool {
	var pe *pixivgo.PixivError
	if !errors.As(err, &pe) {
		return false
	}
	if pe.StatusCode != http.StatusBadRequest && pe.StatusCode != http.StatusUnauthorized {
		return false
	}
	return strings.Contains(pe.Body, `"invalid_grant"`)
}
