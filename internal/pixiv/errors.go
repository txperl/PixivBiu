package pixiv

import "errors"

// ErrNotAuthenticated is returned by service calls when no usable access token
// is present. Handlers should translate this into HTTP 401.
var ErrNotAuthenticated = errors.New("pixiv: not authenticated")

// ErrNoRefreshToken is returned when a caller asked to authenticate but no
// refresh token is available (neither supplied nor present in state).
var ErrNoRefreshToken = errors.New("pixiv: no refresh_token")

// ErrNoAuthCode is returned when the OAuth exchange handler is called with
// an empty authorization code (or a URL that doesn't contain one).
var ErrNoAuthCode = errors.New("pixiv: no authorization code")
