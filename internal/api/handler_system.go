package api

import (
	"errors"
	"net/http"
	"runtime"
	"time"

	"github.com/txperl/PixivBiu/internal/update"
)

// applyWriteDeadline bounds the ApplyUpdate response write. It must comfortably
// exceed Apply's worst case (the checksums + archive downloads, each on a 5m
// context, plus extract/swap) so a slow/proxied download never trips the write
// deadline before the 202 is sent.
const applyWriteDeadline = 15 * time.Minute

// checkWriteDeadline bounds the CheckForUpdate response write. Check contacts
// GitHub with its own ~20s budget (fetchReleases), which can outlast the
// server's default 15s write timeout on a slow network/proxy; without extending
// the deadline the 200/502 would be written too late and the client would see a
// dropped request instead of the result. Must exceed that ~20s check budget.
const checkWriteDeadline = 30 * time.Second

// appRequestHeader is a custom header the SPA sends on every request. On the
// binary-replacing ApplyUpdate it doubles as a CSRF guard: a browser cannot add
// a non-safelisted header to a cross-origin request without a CORS preflight,
// which this server never grants — so a malicious page can *send* a simple POST
// to localhost (CORS blocks reading the response, not sending it) but cannot
// forge this header. Same-origin SPA requests carry it freely. The value is
// irrelevant; only its presence matters. Keep the name in sync with the frontend
// api client (lib/api/client.ts).
const appRequestHeader = "X-PixivBiu-App"

// ErrMissingAppHeader is returned when a state-changing request lacks the SPA's
// appRequestHeader — a likely cross-origin/CSRF attempt. It's a sentinel (like
// pixiv.ErrNotAuthenticated): registered in sentinelErrors so classify maps it
// to 403 and the frontend localizes it by code (error_forbidden).
var ErrMissingAppHeader = errors.New("missing " + appRequestHeader + " request header")

// requireAppRequest rejects a request missing appRequestHeader — the CSRF guard
// for the binary-replacing ApplyUpdate (see appRequestHeader).
func requireAppRequest(r *http.Request) error {
	if r.Header.Get(appRequestHeader) == "" {
		return ErrMissingAppHeader
	}
	return nil
}

// GetSystemVersion reports the running binary's version and build target.
// Open (no auth) — it's the same value already printed in the boot banner.
func (h *APIHandler) GetSystemVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, SystemVersion{
		Version:   h.version,
		GoVersion: runtime.Version(),
		Os:        runtime.GOOS,
		Arch:      runtime.GOARCH,
	})
}

// GetUpdateStatus returns the cached update-check result without hitting the
// network. Open (no auth) so the About panel can show the version freely.
func (h *APIHandler) GetUpdateStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, updateStatusToWire(h.upd.Status()))
}

// CheckForUpdate forces a fresh check against GitHub and returns the result.
// Categorized failures are mapped by updateFailure: a refusal (e.g. no
// applicable release) is a 400, a GitHub reachability failure is a 502. The
// cached status (with last_error set) is also updated so a subsequent GET
// reflects it.
func (h *APIHandler) CheckForUpdate(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	// Check's GitHub fetch can outlast the server's default 15s write timeout on
	// a slow network/proxy; extend the deadline (as ApplyUpdate does) so the real
	// 200/502 still reaches the client. Mirrors the SSE opt-out (internal/inbox/sse.go).
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(checkWriteDeadline))
	st, err := h.upd.Check(r.Context())
	if err != nil {
		WriteError(w, r, updateFailure(err))
		return
	}
	writeJSON(w, http.StatusOK, updateStatusToWire(st))
}

// ApplyUpdate downloads, verifies, and applies the latest release, then
// triggers a graceful self-restart — mirroring RestartConfig: the 202 is
// flushed before the restart fires so the client sees it before its connection
// drops. It requires the app's CSRF header (requireAppRequest) because it
// replaces the binary, and Apply itself rejects a concurrent run (409). Other
// failures are categorized by updateFailure: authored refusals (dev build, no
// asset, checksum mismatch, already up-to-date) surface as a 400 with the
// message; GitHub/download failures as a 502; local apply failures as a 500.
func (h *APIHandler) ApplyUpdate(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	// CSRF guard: a binary swap + restart must originate from the app, not a
	// cross-origin page replaying this no-body POST against authenticated state.
	if err := requireAppRequest(r); err != nil {
		WriteError(w, r, err)
		return
	}
	if h.restart == nil {
		WriteError(w, r, errors.New("restart trigger not configured"))
		return
	}
	// Apply downloads/verifies/swaps the binary synchronously — minutes on a
	// large or proxied release, well past the server's WriteTimeout (15s by
	// default). Extend this request's write deadline so the 202 below still
	// reaches the client; otherwise the write/flush fails (while restart still
	// fires) and the frontend never enters its restart-poll/reload path. The
	// work is bounded by Apply's own per-download context timeouts. Mirrors the
	// SSE handler's opt-out (internal/inbox/sse.go).
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(applyWriteDeadline))

	if err := h.upd.Apply(r.Context()); err != nil {
		WriteError(w, r, updateFailure(err))
		return
	}
	writeJSON(w, http.StatusAccepted, UpdateApplyAccepted{Status: "updating"})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	h.restart()
}

// updateUpstreamMessage is shown when the updater can't reach GitHub or download
// a release asset. It names the update server on purpose: the failing upstream
// here is GitHub, not Pixiv, so it must NOT fall back to the generic
// upstream_error copy ("Pixiv is temporarily unavailable").
const updateUpstreamMessage = "Couldn't reach the update server (GitHub). Check your network or proxy and try again."

// updateFailure maps a categorized *update.Error onto the wire error with the
// right HTTP status. Authored refusals are shown verbatim (400); a rejected
// concurrent apply is shown verbatim (409); GitHub/download transport or HTTP
// failures get an update-specific upstream message (502); local apply failures
// fall through to classify as a generic internal error (500), with full detail
// logged.
func updateFailure(err error) error {
	var ue *update.Error
	if !errors.As(err, &ue) {
		return err
	}
	switch ue.Kind {
	case update.KindRefused:
		// Authored, user-safe message; shown verbatim (capitalized for the UI).
		return &updateUserError{cause: ue, message: capitalize(ue.Message), code: ErrorCodeBadRequest}
	case update.KindConflict:
		// Authored, user-safe message (e.g. an apply already in progress); 409.
		return &updateUserError{cause: ue, message: capitalize(ue.Message), code: ErrorCodeConflict}
	case update.KindUpstream:
		// Update-specific message, shown verbatim. Leaving it empty would let the
		// frontend localize code=upstream_error as a *Pixiv* outage, which is
		// wrong here — the upstream is GitHub. The code still maps to 502.
		return &updateUserError{cause: ue, message: updateUpstreamMessage, code: ErrorCodeUpstreamError}
	default: // KindInternal: generic 500 via classify, full detail logged.
		return err
	}
}

// updateStatusToWire maps the service's Status onto the OpenAPI model, leaving
// optional fields nil when empty/zero.
func updateStatusToWire(s update.Status) UpdateStatus {
	out := UpdateStatus{
		CurrentVersion:  s.CurrentVersion,
		UpdateAvailable: s.UpdateAvailable,
		IsDev:           s.IsDev,
		LatestVersion:   strPtrOrNil(s.LatestVersion),
		ReleaseUrl:      strPtrOrNil(s.ReleaseURL),
		ReleaseNotes:    strPtrOrNil(s.ReleaseNotes),
		AssetName:       strPtrOrNil(s.AssetName),
		LastError:       strPtrOrNil(s.LastError),
		PublishedAt:     timePtrOrNil(s.PublishedAt),
		LastChecked:     timePtrOrNil(s.LastChecked),
	}
	return out
}

func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func timePtrOrNil(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

// capitalize upper-cases the first byte so authored lowercase error strings
// (e.g. "already on the latest version") read as a sentence in the UI.
func capitalize(s string) string {
	if s == "" {
		return s
	}
	b := []byte(s)
	if b[0] >= 'a' && b[0] <= 'z' {
		b[0] -= 'a' - 'A'
	}
	return string(b)
}

// updateUserError adapts a categorized *update.Error to the api UserError
// contract (kind=app + an explicit code). Error()/Unwrap() delegate to the
// wrapped cause (reused for logging); only UserMessage()/APICode() differ.
// message is what the client sees (empty => the frontend localizes by code).
// Built only by updateFailure.
type updateUserError struct {
	cause   *update.Error
	message string
	code    ErrorCode
}

func (e *updateUserError) Error() string       { return e.cause.Error() }
func (e *updateUserError) Unwrap() error       { return e.cause }
func (e *updateUserError) UserMessage() string { return e.message }
func (e *updateUserError) APICode() ErrorCode  { return e.code }
