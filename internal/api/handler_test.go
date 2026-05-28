package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/auth"
	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/download"
	"github.com/txperl/PixivBiu/internal/pixiv"
)

// jsonSyntaxErr / jsonUnmarshalErr produce real encoding/json errors so
// the wrapping/pointer-vs-value cases are exercised exactly the way
// writeError forwards them from the handler decoders.
func jsonSyntaxErr(t *testing.T) error {
	t.Helper()
	err := json.Unmarshal([]byte("{not json"), &struct{}{})
	if err == nil {
		t.Fatal("expected a syntax error from malformed JSON input")
	}
	return err
}

func jsonUnmarshalErr(t *testing.T) error {
	t.Helper()
	err := json.Unmarshal([]byte(`{"illust_id":"oops"}`), &struct {
		IllustId int64 `json:"illust_id"`
	}{})
	if err == nil {
		t.Fatal("expected UnmarshalTypeError from wrong-typed field")
	}
	return err
}

func TestClassify_Sentinels(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		wantCode ErrorCode
		wantKind ErrorKind
		wantHTTP int
	}{
		{"not authenticated", pixiv.ErrNotAuthenticated, ErrorCodeUnauthenticated, ErrorKindApp, http.StatusUnauthorized},
		{"pixivgo auth required", pixivgo.ErrAuthRequired, ErrorCodeUnauthenticated, ErrorKindApp, http.StatusUnauthorized},
		{"no refresh token", pixiv.ErrNoRefreshToken, ErrorCodeBadRequest, ErrorKindApp, http.StatusBadRequest},
		{"no auth code", pixiv.ErrNoAuthCode, ErrorCodeBadRequest, ErrorKindApp, http.StatusBadRequest},
		{"unknown pkce state", auth.ErrUnknownState, ErrorCodeBadRequest, ErrorKindApp, http.StatusBadRequest},
		{"wrapped unknown state", fmt.Errorf("consume verifier: %w", auth.ErrUnknownState), ErrorCodeBadRequest, ErrorKindApp, http.StatusBadRequest},
		{"invalid illust", download.ErrInvalidIllust, ErrorCodeBadRequest, ErrorKindApp, http.StatusBadRequest},
		{"non-terminal", download.ErrNonTerminalStatus, ErrorCodeBadRequest, ErrorKindApp, http.StatusBadRequest},
		{"download not found", download.ErrNotFound, ErrorCodeNotFound, ErrorKindApp, http.StatusNotFound},
		{"already terminal", download.ErrAlreadyTerminal, ErrorCodeConflict, ErrorKindApp, http.StatusConflict},
		{"still running", download.ErrStillRunning, ErrorCodeConflict, ErrorKindApp, http.StatusConflict},
		{"wrapped still running", fmt.Errorf("delete job: %w", download.ErrStillRunning), ErrorCodeConflict, ErrorKindApp, http.StatusConflict},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, body := classify(c.err)
			if status != c.wantHTTP {
				t.Errorf("status: want %d, got %d", c.wantHTTP, status)
			}
			if body.Code != c.wantCode {
				t.Errorf("code: want %q, got %q", c.wantCode, body.Code)
			}
			if body.Kind != c.wantKind {
				t.Errorf("kind: want %q, got %q", c.wantKind, body.Kind)
			}
			if body.Message != "" {
				t.Errorf("message: want empty, got %q", body.Message)
			}
		})
	}
}

func TestClassify_JSONDecodeErrorsMapTo400(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"syntax", jsonSyntaxErr(t)},
		{"unmarshal type", jsonUnmarshalErr(t)},
		{"unexpected eof", io.ErrUnexpectedEOF},
		{"wrapped syntax", fmt.Errorf("decoding body: %w", jsonSyntaxErr(t))},
		{"wrapped unexpected eof", fmt.Errorf("decoding body: %w", io.ErrUnexpectedEOF)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, body := classify(c.err)
			if status != http.StatusBadRequest {
				t.Errorf("status: want 400, got %d", status)
			}
			if body.Code != ErrorCodeBadRequest {
				t.Errorf("code: want bad_request, got %q", body.Code)
			}
			if body.Kind != ErrorKindApp {
				t.Errorf("kind: want app, got %q", body.Kind)
			}
			if body.Message != "" {
				t.Errorf("message: want empty, got %q", body.Message)
			}
		})
	}
}

func TestClassify_UnknownErrorFallsBackTo500(t *testing.T) {
	status, body := classify(errors.New("some other failure"))
	if status != http.StatusInternalServerError {
		t.Errorf("status: want 500, got %d", status)
	}
	if body.Code != ErrorCodeInternalError {
		t.Errorf("code: want internal_error, got %q", body.Code)
	}
	if body.Kind != ErrorKindInternal {
		t.Errorf("kind: want internal, got %q", body.Kind)
	}
	if body.Message != "" {
		t.Errorf("message: want empty, got %q", body.Message)
	}
}

// Guard: io.EOF (empty body) must NOT be misclassified — only
// io.ErrUnexpectedEOF (truncated body) is a client error.
func TestClassify_ReaderAtEOF(t *testing.T) {
	status, body := classify(io.EOF)
	if status == http.StatusBadRequest || body.Code == ErrorCodeBadRequest {
		t.Errorf("io.EOF should not be classified as bad_request; got code=%q status=%d", body.Code, status)
	}
}

func TestClassify_PatchErrorSurfacesStructuredFields(t *testing.T) {
	pe := &config.PatchError{Errors: map[string]string{
		"download.max_concurrent": "must be >= 1",
		"_":                       "patch must contain at least one setting",
	}}
	status, body := classify(pe)

	if status != http.StatusBadRequest {
		t.Errorf("status: want 400, got %d", status)
	}
	if body.Kind != ErrorKindValidation {
		t.Errorf("kind: want validation, got %q", body.Kind)
	}
	if body.Fields == nil {
		t.Fatal("fields: want populated, got nil")
	}
	if got := (*body.Fields)["download.max_concurrent"]; got != "must be >= 1" {
		t.Errorf("fields[download.max_concurrent]: want %q, got %q", "must be >= 1", got)
	}
	if got := (*body.Fields)["_"]; got != "patch must contain at least one setting" {
		t.Errorf("fields[_]: want general entry, got %q", got)
	}
	// PatchError.Error() joins with "; " — make sure that string never
	// reaches Message even when both entries exist.
	if strings.Contains(body.Message, ";") {
		t.Errorf("message must not contain joined error string; got %q", body.Message)
	}
	if body.Message != "" {
		t.Errorf("message: want empty, got %q", body.Message)
	}
}

func TestClassify_PixivUpstreamClassifiesBody(t *testing.T) {
	// Smoke value asserting the upstream body never reaches the wire.
	japanese := `{"error":{"user_message":"このIDは存在しません","message":"不正なリクエストです"}}`
	cases := []struct {
		name       string
		pe         *pixivgo.PixivError
		wantCode   ErrorCode
		wantStatus int
		wantReason ErrorUpstreamReason
	}{
		{
			"invalid_grant oauth body",
			&pixivgo.PixivError{StatusCode: http.StatusBadRequest, Body: `{"error":"invalid_grant","error_description":"..."}`},
			ErrorCodeBadRequest, http.StatusBadRequest, InvalidGrant,
		},
		{
			"rate limited",
			&pixivgo.PixivError{StatusCode: http.StatusTooManyRequests, Body: "{}"},
			ErrorCodeRateLimited, http.StatusTooManyRequests, RateLimit,
		},
		{
			"japanese body generic",
			&pixivgo.PixivError{StatusCode: http.StatusNotFound, Body: japanese},
			ErrorCodeNotFound, http.StatusNotFound, Generic,
		},
		{
			"unhandled 5xx → upstream_error 502",
			&pixivgo.PixivError{StatusCode: http.StatusBadGateway, Body: "<html>...</html>"},
			ErrorCodeUpstreamError, http.StatusBadGateway, Generic,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, body := classify(c.pe)
			if status != c.wantStatus {
				t.Errorf("status: want %d, got %d", c.wantStatus, status)
			}
			if body.Code != c.wantCode {
				t.Errorf("code: want %q, got %q", c.wantCode, body.Code)
			}
			if body.Kind != ErrorKindUpstream {
				t.Errorf("kind: want upstream, got %q", body.Kind)
			}
			if body.Upstream == nil {
				t.Fatal("upstream: want populated, got nil")
			}
			if body.Upstream.Reason != c.wantReason {
				t.Errorf("upstream.reason: want %q, got %q", c.wantReason, body.Upstream.Reason)
			}
			if body.Upstream.Status != c.pe.StatusCode {
				t.Errorf("upstream.status: want %d, got %d", c.pe.StatusCode, body.Upstream.Status)
			}
			if body.Message != "" {
				t.Errorf("message: want empty, got %q", body.Message)
			}
		})
	}
}

func TestClassify_ParamValidationErrors(t *testing.T) {
	// Cover every oapi-codegen param-error type so they all flow through
	// the validation envelope rather than the legacy bypass.
	leakySource := errors.New("strconv.ParseInt: parsing \"oops\": invalid syntax")
	cases := []struct {
		name      string
		err       error
		wantParam string
	}{
		{"invalid format", &InvalidParamFormatError{ParamName: "id", Err: leakySource}, "id"},
		{"required", &RequiredParamError{ParamName: "word"}, "word"},
		{"unmarshaling", &UnmarshalingParamError{ParamName: "filter", Err: leakySource}, "filter"},
		{"required header", &RequiredHeaderError{ParamName: "X-Foo", Err: leakySource}, "X-Foo"},
		{"unescaped cookie", &UnescapedCookieParamError{ParamName: "session", Err: leakySource}, "session"},
		{"too many values", &TooManyValuesForParamError{ParamName: "status", Count: 3}, "status"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, body := classify(c.err)
			if status != http.StatusBadRequest {
				t.Errorf("status: want 400, got %d", status)
			}
			if body.Kind != ErrorKindValidation {
				t.Errorf("kind: want validation, got %q", body.Kind)
			}
			if body.Fields == nil {
				t.Fatal("fields: want populated, got nil")
			}
			if _, ok := (*body.Fields)[c.wantParam]; !ok {
				t.Errorf("fields: want entry for %q, got %v", c.wantParam, *body.Fields)
			}
			if body.Message != "" {
				t.Errorf("message: want empty (params surface via fields), got %q", body.Message)
			}
			// The wrapped Err on these types includes raw strconv/json
			// text. Confirm none of it bleeds into the wire body.
			if strings.Contains(body.Message, "strconv") || strings.Contains(body.Message, "ParseInt") {
				t.Errorf("message leaks wrapped err text: %q", body.Message)
			}
			for _, v := range *body.Fields {
				if strings.Contains(v, "strconv") || strings.Contains(v, "ParseInt") {
					t.Errorf("fields leaks wrapped err text: %q", v)
				}
			}
		})
	}
}

func TestClassify_UnknownStatusErrorSurfacesAsApp(t *testing.T) {
	err := &UnknownStatusError{Value: "bogus"}
	status, body := classify(err)
	if status != http.StatusBadRequest {
		t.Errorf("status: want 400, got %d", status)
	}
	if body.Code != ErrorCodeBadRequest {
		t.Errorf("code: want bad_request, got %q", body.Code)
	}
	if body.Kind != ErrorKindApp {
		t.Errorf("kind: want app, got %q", body.Kind)
	}
	if !strings.Contains(body.Message, "bogus") {
		t.Errorf("message: want user-facing reference to %q, got %q", "bogus", body.Message)
	}
}

// TestClassify_MessageNeverLeaks is the structural guard: across every
// classify branch reachable through a known-leaky error, body.Message
// must be free of (a) Go package prefixes that hint at err.Error() text,
// and (b) non-ASCII characters that would indicate upstream Pixiv body
// leakage. This is what makes the three historical regressions fail
// loudly if anyone reintroduces err.Error() into the classify path.
func TestClassify_MessageNeverLeaks(t *testing.T) {
	pixivBody := `{"error":{"user_message":"このIDは存在しません","message":"不正なリクエストです"}}`
	cfgErr := &config.PatchError{Errors: map[string]string{
		// A pathological validator output the old "; "-join could have
		// truncated; we want to confirm none of it appears in Message.
		"some.key":  "セッションが切れました",
		"other.key": "pixiv: not authenticated",
	}}

	type sample struct {
		name string
		err  error
	}
	samples := []sample{
		{"sentinel", pixiv.ErrNotAuthenticated},
		{"json syntax", jsonSyntaxErr(t)},
		{"json unmarshal", jsonUnmarshalErr(t)},
		{"unexpected eof", io.ErrUnexpectedEOF},
		{"patch error w/ jp + go-prefix entries", cfgErr},
		{"pixiv 400 jp body", &pixivgo.PixivError{StatusCode: 400, Body: pixivBody}},
		{"pixiv 401 jp body", &pixivgo.PixivError{StatusCode: 401, Body: pixivBody}},
		{"pixiv 429 jp body", &pixivgo.PixivError{StatusCode: 429, Body: pixivBody}},
		{"pixiv 502 jp body", &pixivgo.PixivError{StatusCode: 502, Body: pixivBody}},
		{"unknown wrapped", fmt.Errorf("pixiv: refresh failed: %w", errors.New("ネットワーク失敗"))},
		{"unknown status csv", &UnknownStatusError{Value: "ボーガス"}},
		{"invalid param format", &InvalidParamFormatError{ParamName: "id", Err: errors.New("strconv.ParseInt: parsing \"日本語\": invalid syntax")}},
		{"required param missing", &RequiredParamError{ParamName: "word"}},
	}

	leakyPrefixes := []string{"pixiv:", "pixivgo:", "download:", "auth:", "config:"}

	for _, s := range samples {
		t.Run(s.name, func(t *testing.T) {
			_, body := classify(s.err)
			for _, p := range leakyPrefixes {
				if strings.Contains(body.Message, p) {
					t.Errorf("message leaks Go package prefix %q: %q", p, body.Message)
				}
			}
			for _, r := range body.Message {
				if r > 127 {
					// UnknownStatusError formats the user-supplied
					// value; non-ASCII there reflects what the *client*
					// sent in, not anything Pixiv-authored. That case
					// is allowed.
					if _, ok := s.err.(*UnknownStatusError); ok {
						continue
					}
					t.Errorf("message contains non-ASCII rune %q (likely upstream-body leak): %q", r, body.Message)
					break
				}
			}
		})
	}
}

func TestParseStatusList(t *testing.T) {
	str := func(s string) *string { return &s }

	cases := []struct {
		name    string
		in      *string
		want    []download.Status
		wantErr bool
	}{
		{"nil", nil, nil, false},
		{"empty string", str(""), nil, false},
		{"whitespace-only csv", str(" , ,"), nil, false},
		{"single", str("queued"), []download.Status{download.StatusQueued}, false},
		{
			"all five",
			str("queued,running,completed,failed,cancelled"),
			[]download.Status{
				download.StatusQueued,
				download.StatusRunning,
				download.StatusCompleted,
				download.StatusFailed,
				download.StatusCancelled,
			},
			false,
		},
		{"with spaces", str(" queued , running "), []download.Status{download.StatusQueued, download.StatusRunning}, false},
		{"unknown value", str("queued,bogus"), nil, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := parseStatusList(c.in)
			if c.wantErr {
				if err == nil {
					t.Fatalf("want error, got nil; result=%v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(got) != len(c.want) {
				t.Fatalf("len: want %d, got %d (%v)", len(c.want), len(got), got)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Errorf("[%d]: want %q, got %q", i, c.want[i], got[i])
				}
			}
		})
	}
}

func TestExtractAuthCode(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"bare code", "abc-123", "abc-123"},
		{"trims whitespace", "  abc-123  \n", "abc-123"},
		{"empty", "", ""},
		{"empty after trim", "   ", ""},
		{
			"pixiv callback URL",
			"https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback?code=THE_CODE&foo=bar",
			"THE_CODE",
		},
		{
			"http URL",
			"http://example.com/cb?code=XYZ",
			"XYZ",
		},
		{
			"URL without code falls through to raw",
			"https://example.com/no-code-here",
			"https://example.com/no-code-here",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := extractAuthCode(c.in); got != c.want {
				t.Errorf("extractAuthCode(%q): want %q, got %q", c.in, c.want, got)
			}
		})
	}
}
