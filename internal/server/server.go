package server

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httplog/v3"

	"github.com/txperl/PixivBiu/internal/api"
	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/web"
)

const apiBase = "/api/v1"

func New(cfg *config.Config, logger *slog.Logger, h *api.APIHandler) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(httplog.RequestLogger(logger, &httplog.Options{
		Level:         slog.LevelInfo,
		Schema:        httplog.SchemaECS,
		RecoverPanics: true,
	}))

	// Dev docs. /docs renders Scalar API Reference; /openapi.json feeds it
	// from the oapi-codegen embedded spec. Both sit outside /api/v1.
	r.Get("/docs", handleDocs)
	r.Get("/openapi.json", handleOpenAPI)

	// Everything not matched by the API or docs falls through here. The
	// oapi-codegen routes are registered flat on this same router, so an
	// unmapped /api/v1/* path lands here too — answer those with the
	// structured JSON 404 envelope; serve the embedded SPA for the rest
	// (with index.html fallback for client-side routes).
	spa := web.Handler()
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasPrefix(req.URL.Path, apiBase) {
			api.WriteError(w, req, &api.RouteNotFoundError{Method: req.Method, Path: req.URL.Path})
			return
		}
		spa.ServeHTTP(w, req)
	})

	return api.HandlerWithOptions(h, api.ChiServerOptions{
		BaseURL:          apiBase,
		BaseRouter:       r,
		ErrorHandlerFunc: api.WriteError,
	})
}
