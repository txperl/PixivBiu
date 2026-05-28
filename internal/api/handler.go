package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"sync/atomic"

	"github.com/go-chi/httplog/v3"
	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/auth"
	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/download"
	"github.com/txperl/PixivBiu/internal/inbox"
	"github.com/txperl/PixivBiu/internal/pixiv"
)

type APIHandler struct {
	svc  *pixiv.Service
	hub  *inbox.Hub
	dl   *download.Manager
	pkce *auth.Store
	// heartbeat is the SSE keep-alive interval in nanoseconds, read per
	// connection so a hot-reload of inbox.heartbeat affects new streams.
	heartbeat *atomic.Int64
	cfgMgr    *config.Manager
	// restart triggers a graceful self-restart of the process; nil-safe
	// (RestartConfig guards against a nil trigger).
	restart func()
}

func NewHandler(svc *pixiv.Service, hub *inbox.Hub, dl *download.Manager, pkce *auth.Store, heartbeat *atomic.Int64, cfgMgr *config.Manager, restart func()) *APIHandler {
	return &APIHandler{svc: svc, hub: hub, dl: dl, pkce: pkce, heartbeat: heartbeat, cfgMgr: cfgMgr, restart: restart}
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

// writeError classifies err, attaches error.message + error.type to the
// current request's httplog entry (via context), and writes a JSON error
// body with the appropriate HTTP status. No separate log event is emitted —
// httplog rolls the error into the single http.request log line and
// auto-levels it (4xx→Warn, 5xx→Error).
func (h *APIHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	code, status, detail := classify(err)
	httplog.SetError(r.Context(), err)
	httplog.SetAttrs(r.Context(), slog.String("error.type", code))
	body := Error{Code: code, Message: err.Error()}
	if detail != "" {
		body.Detail = &detail
	}
	writeJSON(w, status, body)
}

func classify(err error) (code string, status int, detail string) {
	switch {
	case errors.Is(err, pixiv.ErrNotAuthenticated),
		errors.Is(err, pixivgo.ErrAuthRequired):
		return "unauthenticated", http.StatusUnauthorized, ""
	case errors.Is(err, pixiv.ErrNoRefreshToken),
		errors.Is(err, pixiv.ErrNoAuthCode),
		errors.Is(err, auth.ErrUnknownState),
		errors.Is(err, download.ErrInvalidIllust),
		errors.Is(err, download.ErrNonTerminalStatus):
		return "bad_request", http.StatusBadRequest, ""
	case errors.Is(err, download.ErrNotFound):
		return "not_found", http.StatusNotFound, ""
	case errors.Is(err, download.ErrAlreadyTerminal),
		errors.Is(err, download.ErrStillRunning):
		return "conflict", http.StatusConflict, ""
	}
	// Malformed JSON request bodies surface as these typed errors from
	// encoding/json; classify them as client errors instead of 500.
	var (
		jsonSyntax    *json.SyntaxError
		jsonUnmarshal *json.UnmarshalTypeError
	)
	if errors.As(err, &jsonSyntax) ||
		errors.As(err, &jsonUnmarshal) ||
		errors.Is(err, io.ErrUnexpectedEOF) {
		return "bad_request", http.StatusBadRequest, ""
	}
	// Config patch/reset validation errors carry per-key messages.
	// Surface the joined message via detail so the client can show it.
	var cfgErr *config.PatchError
	if errors.As(err, &cfgErr) {
		return "bad_request", http.StatusBadRequest, cfgErr.Error()
	}
	var pe *pixivgo.PixivError
	if errors.As(err, &pe) {
		switch pe.StatusCode {
		case http.StatusBadRequest:
			return "bad_request", http.StatusBadRequest, pe.Body
		case http.StatusUnauthorized:
			return "unauthenticated", http.StatusUnauthorized, pe.Body
		case http.StatusForbidden:
			return "forbidden", http.StatusForbidden, pe.Body
		case http.StatusNotFound:
			return "not_found", http.StatusNotFound, pe.Body
		case http.StatusTooManyRequests:
			return "rate_limited", http.StatusTooManyRequests, pe.Body
		default:
			if pe.StatusCode >= 400 {
				return "upstream_error", http.StatusBadGateway, pe.Body
			}
		}
	}
	return "internal_error", http.StatusInternalServerError, ""
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
