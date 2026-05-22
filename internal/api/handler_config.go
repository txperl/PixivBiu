package api

import (
	"net/http"

	"github.com/txperl/PixivBiu/internal/config"
)

// GetConfig returns the current effective config, the persisted overrides,
// and the per-key source labels. Sensitive fields are masked in both views.
func (h *APIHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	view, err := h.cfgMgr.View()
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, viewToWire(view))
}

// GetConfigSchema returns the reflected JSON Schema. The body is passed
// through as-is; the openapi spec types it as a free-form object.
func (h *APIHandler) GetConfigSchema(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, h.cfgMgr.Schema().JSON)
}

// PatchConfig merges the incoming map into the file layer.
// On validation failure it returns 400 with per-key messages.
func (h *APIHandler) PatchConfig(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	var body PatchConfigJSONRequestBody
	if err := decodeJSON(r, &body); err != nil {
		h.writeError(w, r, err)
		return
	}
	view, err := h.cfgMgr.Patch(map[string]any(body))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, viewToWire(view))
}

// ResetConfig drops keys (or the entire file layer) and returns the refreshed view.
func (h *APIHandler) ResetConfig(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	var body ResetConfigJSONRequestBody
	if err := decodeJSON(r, &body); err != nil {
		h.writeError(w, r, err)
		return
	}
	var keys []string
	if body.Keys != nil {
		keys = *body.Keys
	}
	all := body.All != nil && *body.All
	view, err := h.cfgMgr.Reset(keys, all)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, viewToWire(view))
}

func viewToWire(v *config.View) ConfigView {
	srcs := make(map[string]ConfigSource, len(v.Sources))
	for k, s := range v.Sources {
		srcs[k] = ConfigSource(s)
	}
	return ConfigView{
		Effective:     v.Effective,
		File:          v.File,
		Sources:       srcs,
		SchemaVersion: v.SchemaVersion,
	}
}
