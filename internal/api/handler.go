package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type APIHandler struct {
	logger *slog.Logger
}

func NewHandler(logger *slog.Logger) *APIHandler {
	return &APIHandler{logger: logger}
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
