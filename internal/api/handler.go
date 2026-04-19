package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/httplog/v3"
	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/pixiv"
)

type APIHandler struct {
	svc *pixiv.Service
}

func NewHandler(svc *pixiv.Service) *APIHandler {
	return &APIHandler{svc: svc}
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
	case errors.Is(err, pixiv.ErrNoRefreshToken):
		return "bad_request", http.StatusBadRequest, ""
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
