package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/txperl/PixivBiu/internal/download"
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
