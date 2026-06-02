package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/txperl/PixivBiu/internal/update"
)

// updateFailure must map each update failure category to the right wire code so
// a GitHub/download outage surfaces as 502 (not a 400 with raw text) and a
// local apply failure as a generic 500.
func TestUpdateFailureClassification(t *testing.T) {
	// KindRefused → bad_request, shown verbatim and capitalized.
	refused := updateFailure(&update.Error{Kind: update.KindRefused, Message: "already on the latest version"})
	if ue, ok := errors.AsType[UserError](refused); !ok {
		t.Error("KindRefused should surface as a UserError")
	} else {
		if ue.APICode() != ErrorCodeBadRequest {
			t.Errorf("KindRefused code = %v, want bad_request", ue.APICode())
		}
		if ue.UserMessage() != "Already on the latest version" {
			t.Errorf("KindRefused message = %q, want capitalized", ue.UserMessage())
		}
	}

	// KindConflict → conflict (409), shown verbatim and capitalized.
	conflict := updateFailure(&update.Error{Kind: update.KindConflict, Message: "an update is already being applied"})
	if ue, ok := errors.AsType[UserError](conflict); !ok {
		t.Error("KindConflict should surface as a UserError")
	} else {
		if ue.APICode() != ErrorCodeConflict {
			t.Errorf("KindConflict code = %v, want conflict", ue.APICode())
		}
		if ue.UserMessage() != "An update is already being applied" {
			t.Errorf("KindConflict message = %q, want capitalized", ue.UserMessage())
		}
	}

	// KindUpstream → upstream_error with an update-specific message shown verbatim.
	// It must be non-empty: an empty message would let the frontend fall back to
	// localizing upstream_error as a Pixiv outage, which is wrong for a GitHub
	// failure during an update.
	upstream := updateFailure(&update.Error{Kind: update.KindUpstream})
	if ue, ok := errors.AsType[UserError](upstream); !ok {
		t.Error("KindUpstream should surface as a UserError")
	} else {
		if ue.APICode() != ErrorCodeUpstreamError {
			t.Errorf("KindUpstream code = %v, want upstream_error", ue.APICode())
		}
		if ue.UserMessage() != updateUpstreamMessage {
			t.Errorf("KindUpstream message = %q, want the update-specific message", ue.UserMessage())
		}
	}

	// KindInternal must NOT opt into UserError, so classify renders a generic 500.
	internal := updateFailure(&update.Error{Kind: update.KindInternal, Message: "boom"})
	if _, ok := errors.AsType[UserError](internal); ok {
		t.Error("KindInternal should not surface as a UserError (want generic internal_error)")
	}

	// A non-categorized error passes through untouched.
	plain := errors.New("plain")
	if got := updateFailure(plain); got != plain {
		t.Errorf("uncategorized error = %v, want pass-through", got)
	}
}

// requireAppRequest is the CSRF guard for ApplyUpdate: a request lacking the app
// header is rejected with the ErrMissingAppHeader sentinel (classify maps it to
// 403); one carrying it passes. A cross-origin page cannot forge the header, so
// this blocks the forged self-update.
func TestRequireAppRequest(t *testing.T) {
	bare := httptest.NewRequest(http.MethodPost, "/system/update/apply", nil)
	if err := requireAppRequest(bare); !errors.Is(err, ErrMissingAppHeader) {
		t.Fatalf("missing app header = %v, want ErrMissingAppHeader", err)
	}
	// The sentinel must classify as a 403 the frontend localizes by code.
	if status, body := classify(ErrMissingAppHeader); status != http.StatusForbidden || body.Code != ErrorCodeForbidden {
		t.Errorf("classify(ErrMissingAppHeader) = (%d, %q), want (403, forbidden)", status, body.Code)
	}

	withHeader := httptest.NewRequest(http.MethodPost, "/system/update/apply", nil)
	withHeader.Header.Set(appRequestHeader, "1")
	if err := requireAppRequest(withHeader); err != nil {
		t.Errorf("request with app header = %v, want nil", err)
	}
}
