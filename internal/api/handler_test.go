package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/txperl/PixivBiu/internal/auth"
	"github.com/txperl/PixivBiu/internal/download"
	"github.com/txperl/PixivBiu/internal/pixiv"
)

func TestClassify_JSONDecodeErrorsMapTo400(t *testing.T) {
	// Actual errors produced by encoding/json so we catch anything
	// that slips past a direct type assertion (wrapped, pointer vs
	// value receiver, etc.) the way writeError forwards them.
	var syntaxErr error
	if err := json.Unmarshal([]byte("{not json"), &struct{}{}); err != nil {
		syntaxErr = err
	} else {
		t.Fatal("expected a syntax error from malformed JSON input")
	}

	var unmarshalErr error
	if err := json.Unmarshal([]byte(`{"illust_id":"oops"}`), &struct {
		IllustId int64 `json:"illust_id"`
	}{}); err != nil {
		unmarshalErr = err
	} else {
		t.Fatal("expected UnmarshalTypeError from wrong-typed field")
	}

	cases := []struct {
		name string
		err  error
	}{
		{"syntax", syntaxErr},
		{"unmarshal type", unmarshalErr},
		{"unexpected eof", io.ErrUnexpectedEOF},
		{"wrapped syntax", fmt.Errorf("decoding body: %w", syntaxErr)},
		{"wrapped unexpected eof", fmt.Errorf("decoding body: %w", io.ErrUnexpectedEOF)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, status, _ := classify(c.err)
			if status != http.StatusBadRequest {
				t.Errorf("status: want 400, got %d", status)
			}
			if code != "bad_request" {
				t.Errorf("code: want bad_request, got %q", code)
			}
		})
	}
}

func TestClassify_UnknownErrorFallsBackTo500(t *testing.T) {
	code, status, _ := classify(errors.New("some other failure"))
	if status != http.StatusInternalServerError {
		t.Errorf("status: want 500, got %d", status)
	}
	if code != "internal_error" {
		t.Errorf("code: want internal_error, got %q", code)
	}
}

func TestClassify_DownloadConflictErrorsMapTo409(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"already terminal", download.ErrAlreadyTerminal},
		{"still running", download.ErrStillRunning},
		{"wrapped still running", fmt.Errorf("delete job: %w", download.ErrStillRunning)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, status, _ := classify(c.err)
			if status != http.StatusConflict {
				t.Errorf("status: want 409, got %d", status)
			}
			if code != "conflict" {
				t.Errorf("code: want conflict, got %q", code)
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

func TestClassify_OAuthErrorsMapTo400(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"no auth code", pixiv.ErrNoAuthCode},
		{"unknown pkce state", auth.ErrUnknownState},
		{"wrapped unknown state", fmt.Errorf("consume verifier: %w", auth.ErrUnknownState)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, status, _ := classify(c.err)
			if status != http.StatusBadRequest {
				t.Errorf("status: want 400, got %d", status)
			}
			if code != "bad_request" {
				t.Errorf("code: want bad_request, got %q", code)
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

// Guard against future refactors that drop the io import / stop
// treating Decoder errors specifically.
func TestClassify_ReaderAtEOF(t *testing.T) {
	// Decoder on an empty body returns io.EOF, which handlers already
	// skip via errors.Is(..., io.EOF). We should NOT misclassify EOF
	// itself as bad_request — only ErrUnexpectedEOF.
	code, status, _ := classify(io.EOF)
	if strings.EqualFold(code, "bad_request") || status == http.StatusBadRequest {
		t.Errorf("io.EOF should not be classified as bad_request; got code=%q status=%d", code, status)
	}
}
