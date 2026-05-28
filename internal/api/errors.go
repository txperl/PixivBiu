package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// UserError lets a service-layer error opt into "safe to display": the
// classify dispatcher will surface .UserMessage() as Error.message with
// kind=app and use .APICode() as the wire code. Without this opt-in,
// errors fall through to kind=internal with an empty Message (the
// frontend localizes via code), guaranteeing raw err.Error() text never
// reaches the client.
type UserError interface {
	error
	UserMessage() string
	APICode() ErrorCode
}

// UnknownStatusError covers the `?status=…` CSV in the downloads
// handlers — the only inline `Error{}` construction outside writeError
// before this refactor. Promoting it to a typed error puts both call
// sites back on the normal writeError path.
type UnknownStatusError struct {
	Value string
}

func (e *UnknownStatusError) Error() string {
	return fmt.Sprintf("unknown download status %q", e.Value)
}

func (e *UnknownStatusError) UserMessage() string {
	return fmt.Sprintf("Unknown download status %q.", e.Value)
}

func (*UnknownStatusError) APICode() ErrorCode { return ErrorCodeBadRequest }

// paramValidationFailure unwraps oapi-codegen's parameter-validation
// error types into a safe (name, summary) pair, dropping the wrapped
// Err — its text often quotes raw decoder output. Returns ("", "") if
// err is none of the recognised types.
func paramValidationFailure(err error) (param, msg string) {
	var (
		invalidFormat *InvalidParamFormatError
		required      *RequiredParamError
		unmarshaling  *UnmarshalingParamError
		requiredHdr   *RequiredHeaderError
		unescapedCkie *UnescapedCookieParamError
		tooMany       *TooManyValuesForParamError
	)
	switch {
	case errors.As(err, &invalidFormat):
		return invalidFormat.ParamName, "Invalid format."
	case errors.As(err, &required):
		return required.ParamName, "Required parameter is missing."
	case errors.As(err, &unmarshaling):
		return unmarshaling.ParamName, "Could not be parsed."
	case errors.As(err, &requiredHdr):
		return requiredHdr.ParamName, "Required header is missing."
	case errors.As(err, &unescapedCkie):
		return unescapedCkie.ParamName, "Cookie value could not be unescaped."
	case errors.As(err, &tooMany):
		return tooMany.ParamName, "Too many values supplied."
	}
	return "", ""
}

// codeToStatus is the single source of truth for code → HTTP status.
// statusForCode reads it directly; mapPixivStatus picks the code then
// defers to it.
var codeToStatus = map[ErrorCode]int{
	ErrorCodeUnauthenticated: http.StatusUnauthorized,
	ErrorCodeBadRequest:      http.StatusBadRequest,
	ErrorCodeNotFound:        http.StatusNotFound,
	ErrorCodeConflict:        http.StatusConflict,
	ErrorCodeForbidden:       http.StatusForbidden,
	ErrorCodeRateLimited:     http.StatusTooManyRequests,
	ErrorCodeUpstreamError:   http.StatusBadGateway,
	ErrorCodeInternalError:   http.StatusInternalServerError,
}

// statusForCode picks the HTTP status for a wire code, defaulting to
// 500 when a UserError supplies a code we haven't enumerated.
func statusForCode(code ErrorCode) int {
	if s, ok := codeToStatus[code]; ok {
		return s
	}
	return http.StatusInternalServerError
}

// mapPixivStatus translates a Pixiv HTTP status into our wire code +
// status. Pixiv 5xx (and any 4xx we don't have a specific mapping for)
// collapses to upstream_error → 502.
func mapPixivStatus(pixivStatus int) (ErrorCode, int) {
	var code ErrorCode
	switch pixivStatus {
	case http.StatusBadRequest:
		code = ErrorCodeBadRequest
	case http.StatusUnauthorized:
		code = ErrorCodeUnauthenticated
	case http.StatusForbidden:
		code = ErrorCodeForbidden
	case http.StatusNotFound:
		code = ErrorCodeNotFound
	case http.StatusTooManyRequests:
		code = ErrorCodeRateLimited
	default:
		code = ErrorCodeUpstreamError
	}
	return code, statusForCode(code)
}

// classifyPixivBody peeks at the Pixiv response body to assign a stable
// reason token. Anything we don't recognise falls back to `generic` — the
// raw body (Japanese or otherwise) is never returned, only logged via
// httplog.SetError on the underlying error.
func classifyPixivBody(body string, pixivStatus int) ErrorUpstreamReason {
	if pixivStatus == http.StatusTooManyRequests {
		return RateLimit
	}
	// OAuth token endpoint emits {"error":"invalid_grant", ...} when a
	// refresh token is expired/revoked. Substring match is enough: the
	// payload is a short JSON document and `invalid_grant` doesn't
	// appear in other Pixiv error shapes.
	if strings.Contains(body, `"invalid_grant"`) {
		return InvalidGrant
	}
	return Generic
}
