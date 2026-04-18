package pixiv

import "errors"

// ErrNotAuthenticated is returned by service calls when no usable access token
// is present. Handlers should translate this into HTTP 401.
var ErrNotAuthenticated = errors.New("pixiv: not authenticated")

// ErrNoRefreshToken is returned when a caller asked to authenticate but no
// refresh token is available (neither supplied nor present in state).
var ErrNoRefreshToken = errors.New("pixiv: no refresh_token")
