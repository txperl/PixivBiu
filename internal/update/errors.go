package update

import "fmt"

// FailureKind categorizes an update failure so the API layer can map it to the
// right HTTP status without string-matching err.Error().
type FailureKind int

const (
	// KindRefused is a precondition or verification failure with an authored,
	// user-safe message (dev build, no matching asset, checksum mismatch, no
	// applicable release, …). The API surfaces it as a 400 and shows Message.
	KindRefused FailureKind = iota
	// KindUpstream is a failure while contacting GitHub or downloading an asset
	// (network error or non-2xx HTTP). The detail is logged, not shown; the API
	// surfaces it as a 502 the frontend localizes generically.
	KindUpstream
	// KindInternal is a failure while applying locally (extracting or swapping
	// the binary). The detail is logged; the API surfaces a generic 500.
	KindInternal
	// KindConflict is a rejected concurrent operation (another apply is already
	// running) with an authored, user-safe message. The API surfaces it as a 409
	// and shows Message.
	KindConflict
)

// Error is a categorized update failure. Message is safe to display only for
// KindRefused; cause carries the wrapped detail for logging.
type Error struct {
	Kind    FailureKind
	Message string
	cause   error
}

func (e *Error) Error() string {
	if e.cause != nil && e.Message != "" {
		return e.Message + ": " + e.cause.Error()
	}
	if e.cause != nil {
		return e.cause.Error()
	}
	return e.Message
}

func (e *Error) Unwrap() error { return e.cause }

// refusedf builds a KindRefused error with an authored, user-safe message.
func refusedf(format string, args ...any) *Error {
	return &Error{Kind: KindRefused, Message: fmt.Sprintf(format, args...)}
}

// conflictf builds a KindConflict error with an authored, user-safe message.
func conflictf(format string, args ...any) *Error {
	return &Error{Kind: KindConflict, Message: fmt.Sprintf(format, args...)}
}

// upstreamErr wraps a GitHub/download transport or HTTP failure.
func upstreamErr(cause error) *Error {
	return &Error{Kind: KindUpstream, cause: cause}
}

// internalErr wraps a local apply failure (extract/swap).
func internalErr(message string, cause error) *Error {
	return &Error{Kind: KindInternal, Message: message, cause: cause}
}
