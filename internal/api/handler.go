package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httplog/v3"
	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/auth"
	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/download"
	"github.com/txperl/PixivBiu/internal/imgcache"
	"github.com/txperl/PixivBiu/internal/inbox"
	"github.com/txperl/PixivBiu/internal/pixiv"
	"github.com/txperl/PixivBiu/internal/update"
)

type APIHandler struct {
	svc  *pixiv.Service
	hub  *inbox.Hub
	dl   *download.Manager
	pkce *auth.Store
	// heartbeat is the SSE keep-alive interval in nanoseconds, read per
	// connection so a hot-reload of inbox.heartbeat affects new streams.
	heartbeat *atomic.Int64
	// searchSamplePages is search.sample.pages, read per request so a
	// hot-reload affects the next bookmarks_desc/views_desc search. Same
	// live-via-atomic pattern as heartbeat (Manager.Config() is boot-pinned).
	searchSamplePages *atomic.Int64
	cfgMgr            *config.Manager
	// restart triggers a graceful self-restart of the process; nil-safe
	// (RestartConfig guards against a nil trigger).
	restart func()
	// upd backs the system/update endpoints; version is the running binary's
	// version (main.version), surfaced by GET /system/version.
	upd     *update.Service
	version string
	// img backs GET /proxy/img — fetches + disk-caches Pixiv CDN images.
	img *imgcache.Proxy
}

func NewHandler(svc *pixiv.Service, hub *inbox.Hub, dl *download.Manager, pkce *auth.Store, heartbeat *atomic.Int64, searchSamplePages *atomic.Int64, cfgMgr *config.Manager, restart func(), upd *update.Service, img *imgcache.Proxy, version string) *APIHandler {
	return &APIHandler{svc: svc, hub: hub, dl: dl, pkce: pkce, heartbeat: heartbeat, searchSamplePages: searchSamplePages, cfgMgr: cfgMgr, restart: restart, upd: upd, version: version, img: img}
}

var _ ServerInterface = (*APIHandler)(nil)

func (h *APIHandler) GetHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, HealthStatus{Status: "ok"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// decodeJSON unmarshals the request body into v. EOF is treated as the
// empty body so handlers can keep their "optional body" semantics
// without each duplicating the errors.Is(io.EOF) dance.
func decodeJSON(r *http.Request, v any) error {
	err := json.NewDecoder(r.Body).Decode(v)
	if err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

// WriteError classifies err into a wire-safe Error body and writes it.
// The full Go error always flows into the request's httplog entry (so
// operators see it in logs) but never into the JSON body: classify only
// emits compile-time constants or strings authored via UserError, so
// internal Go text and upstream response bodies cannot leak to the
// client through this path.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	status, body := classify(err)
	httplog.SetError(r.Context(), err)
	httplog.SetAttrs(r.Context(),
		slog.String("error.type", string(body.Code)),
		slog.String("error.kind", string(body.Kind)),
	)
	if reqID := middleware.GetReqID(r.Context()); reqID != "" {
		body.RequestId = &reqID
	}
	writeJSON(w, status, body)
}

var sentinelErrors = []struct {
	err    error
	code   ErrorCode
	status int
}{
	{pixiv.ErrNotAuthenticated, ErrorCodeUnauthenticated, http.StatusUnauthorized},
	{pixivgo.ErrAuthRequired, ErrorCodeUnauthenticated, http.StatusUnauthorized},
	{pixiv.ErrNoRefreshToken, ErrorCodeBadRequest, http.StatusBadRequest},
	{pixiv.ErrNoAuthCode, ErrorCodeBadRequest, http.StatusBadRequest},
	{auth.ErrUnknownState, ErrorCodeBadRequest, http.StatusBadRequest},
	{download.ErrInvalidIllust, ErrorCodeBadRequest, http.StatusBadRequest},
	{download.ErrNonTerminalStatus, ErrorCodeBadRequest, http.StatusBadRequest},
	{download.ErrNotFound, ErrorCodeNotFound, http.StatusNotFound},
	{download.ErrAlreadyTerminal, ErrorCodeConflict, http.StatusConflict},
	{download.ErrStillRunning, ErrorCodeConflict, http.StatusConflict},
	{ErrMissingAppHeader, ErrorCodeForbidden, http.StatusForbidden},
	{imgcache.ErrInvalidURL, ErrorCodeBadRequest, http.StatusBadRequest},
}

// classify maps err to (HTTP status, wire body). Sentinels and generic
// fallbacks emit an empty Message: the frontend treats kind=app with an
// empty message as "localize me by code". Branches that author a
// specific user-facing string (UserError opt-ins) set Message directly.
// err.Error() is never read.
func classify(err error) (int, Error) {
	// Sentinel lookup first — explicit, ordered, fastest to extend.
	for _, s := range sentinelErrors {
		if errors.Is(err, s.err) {
			return s.status, Error{
				Code: s.code,
				Kind: ErrorKindApp,
			}
		}
	}

	// Service-layer opt-in: any error that implements UserError gets
	// surfaced as app-authored text.
	if ue, ok := errors.AsType[UserError](err); ok {
		code := ue.APICode()
		return statusForCode(code), Error{
			Code:    code,
			Kind:    ErrorKindApp,
			Message: ue.UserMessage(),
		}
	}

	// Malformed JSON request bodies — fixed copy, never err.Error().
	var (
		jsonSyntax    *json.SyntaxError
		jsonUnmarshal *json.UnmarshalTypeError
	)
	if errors.As(err, &jsonSyntax) ||
		errors.As(err, &jsonUnmarshal) ||
		errors.Is(err, io.ErrUnexpectedEOF) {
		return http.StatusBadRequest, Error{
			Code: ErrorCodeBadRequest,
			Kind: ErrorKindApp,
		}
	}

	// Config validation: surface PatchError's per-key map verbatim. The
	// map is read-only after construction and the response is marshalled
	// before classify's caller returns, so aliasing is safe.
	if cfgErr, ok := errors.AsType[*config.PatchError](err); ok && len(cfgErr.Errors) > 0 {
		return http.StatusBadRequest, Error{
			Code:   ErrorCodeBadRequest,
			Kind:   ErrorKindValidation,
			Fields: &cfgErr.Errors,
		}
	}

	// oapi-codegen parameter-validation errors (path/query/header parse
	// failures, missing required, etc.) — surface as a single-entry
	// validation map keyed by the parameter name. We deliberately drop
	// the wrapped Err so untrusted underlying text never reaches the
	// wire.
	if param, msg := paramValidationFailure(err); param != "" {
		fields := map[string]string{param: msg}
		return http.StatusBadRequest, Error{
			Code:   ErrorCodeBadRequest,
			Kind:   ErrorKindValidation,
			Fields: &fields,
		}
	}

	// Upstream Pixiv errors: classify status + reason, drop the body.
	if pe, ok := errors.AsType[*pixivgo.PixivError](err); ok {
		code, status := mapPixivStatus(pe.StatusCode)
		reason := classifyPixivBody(pe.Body, pe.StatusCode)
		return status, Error{
			Code: code,
			Kind: ErrorKindUpstream,
			Upstream: &struct {
				Reason ErrorUpstreamReason `json:"reason"`
				Status int                 `json:"status"`
			}{Reason: reason, Status: pe.StatusCode},
		}
	}

	// Image-proxy upstream failures (i.pximg.net) carry the upstream status
	// (0 = no response arrived). Route them through the same kind=upstream
	// discriminator as pixiv upstream errors so the 502 envelope is uniform.
	if ie, ok := errors.AsType[*imgcache.UpstreamError](err); ok {
		reason := Generic
		if ie.Status == http.StatusTooManyRequests {
			reason = RateLimit
		}
		return http.StatusBadGateway, Error{
			Code: ErrorCodeUpstreamError,
			Kind: ErrorKindUpstream,
			Upstream: &struct {
				Reason ErrorUpstreamReason `json:"reason"`
				Status int                 `json:"status"`
			}{Reason: reason, Status: ie.Status},
		}
	}

	// Transport-level failure reaching Pixiv (DNS / refused / reset / timeout):
	// no HTTP response came back, so there's no status to map. It's the network
	// path to Pixiv that failed, not an internal bug — surface it as upstream
	// (502) so the user sees "can't reach Pixiv" rather than a generic 500. This
	// also catches our own context.DeadlineExceeded, which satisfies net.Error.
	// Status 0 marks "no upstream HTTP response".
	if _, ok := errors.AsType[net.Error](err); ok {
		return http.StatusBadGateway, Error{
			Code: ErrorCodeUpstreamError,
			Kind: ErrorKindUpstream,
			Upstream: &struct {
				Reason ErrorUpstreamReason `json:"reason"`
				Status int                 `json:"status"`
			}{Reason: Generic, Status: 0},
		}
	}

	// Fallback: unknown failure → 500 with an empty message; the
	// frontend localizes from the code.
	return http.StatusInternalServerError, Error{
		Code: ErrorCodeInternalError,
		Kind: ErrorKindInternal,
	}
}

// requireAuth short-circuits when the service has no access token.
func (h *APIHandler) requireAuth() error {
	if !h.svc.Authenticated() {
		return pixiv.ErrNotAuthenticated
	}
	return nil
}

// i64OptToIntOpt converts an optional int64 (our OpenAPI pagination cursor)
// to the *int shape pixivgo expects.
func i64OptToIntOpt(p *int64) *int {
	if p == nil {
		return nil
	}
	v := int(*p)
	return &v
}

// derefEnum returns the underlying string of an optional string-enum pointer.
func derefEnum[T ~string](p *T) string {
	if p == nil {
		return ""
	}
	return string(*p)
}
