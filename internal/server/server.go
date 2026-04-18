package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/txperl/PixivBiu/internal/api"
	"github.com/txperl/PixivBiu/internal/config"
)

const apiBase = "/api/v1"

func New(cfg *config.Config, logger *slog.Logger, h *api.APIHandler) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(requestLogger(logger))

	// Dev docs. /docs renders Scalar API Reference; /openapi.json feeds it
	// from the oapi-codegen embedded spec. Both sit outside /api/v1.
	r.Get("/docs", handleDocs)
	r.Get("/openapi.json", handleOpenAPI)

	return api.HandlerWithOptions(h, api.ChiServerOptions{
		BaseURL:          apiBase,
		BaseRouter:       r,
		ErrorHandlerFunc: paramErrorHandler,
	})
}

// paramErrorHandler serialises oapi-codegen's param-validation errors
// (missing required query, bad enum value, bad int parse, ...) into the
// same JSON envelope that our own business handlers produce.
func paramErrorHandler(w http.ResponseWriter, r *http.Request, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(api.Error{
		Code:    "bad_request",
		Message: err.Error(),
	})
}

func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			logger.LogAttrs(r.Context(), slog.LevelInfo, "http.request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", ww.Status()),
				slog.Int("bytes", ww.BytesWritten()),
				slog.Duration("duration", time.Since(start)),
				slog.String("request_id", middleware.GetReqID(r.Context())),
				slog.String("remote", r.RemoteAddr),
			)
		})
	}
}
