package api

import (
	"errors"
	"net/http"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/download"
)

// GetConfig returns the current effective config, the persisted overrides,
// and the per-key source labels. Sensitive fields are masked in both views.
func (h *APIHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	view, err := h.cfgMgr.View()
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, viewToWire(view))
}

// GetConfigSchema returns the reflected JSON Schema. The body is passed
// through as-is; the openapi spec types it as a free-form object.
func (h *APIHandler) GetConfigSchema(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, h.cfgMgr.Schema().JSON)
}

// PatchConfig merges the incoming map into the file layer.
// On validation failure it returns 400 with per-key messages.
func (h *APIHandler) PatchConfig(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	var body PatchConfigJSONRequestBody
	if err := decodeJSON(r, &body); err != nil {
		WriteError(w, r, err)
		return
	}
	view, err := h.cfgMgr.Patch(map[string]any(body))
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, viewToWire(view))
}

// ResetConfig drops keys (or the entire file layer) and returns the refreshed view.
func (h *APIHandler) ResetConfig(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	var body ResetConfigJSONRequestBody
	if err := decodeJSON(r, &body); err != nil {
		WriteError(w, r, err)
		return
	}
	var keys []string
	if body.Keys != nil {
		keys = *body.Keys
	}
	all := body.All != nil && *body.All
	view, err := h.cfgMgr.Reset(keys, all)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, viewToWire(view))
}

// RestartConfig drains in-flight work and re-executes the process so
// settings.json is reloaded — how restart-required keys take effect.
// The 202 is flushed before the trigger fires so the client receives it
// before its connection (and any SSE streams) drop.
func (h *APIHandler) RestartConfig(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	if h.restart == nil {
		WriteError(w, r, errors.New("restart trigger not configured"))
		return
	}
	writeJSON(w, http.StatusAccepted, ConfigRestartAccepted{Status: "restarting"})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	h.restart()
}

// PreviewNaming renders the three download naming templates against a fixed
// sample work for the settings-UI live preview. It persists nothing;
// per-template parse/exec errors come back in the body (still 200) so the
// editor can show inline errors mid-edit without an HTTP error.
// Authoritative validation still happens on PATCH.
func (h *APIHandler) PreviewNaming(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	var body PreviewNamingJSONRequestBody
	if err := decodeJSON(r, &body); err != nil {
		WriteError(w, r, err)
		return
	}

	// Start from the LIVE effective config (h.dl.Conf(), not the stale boot
	// snapshot) so omitted templates fall back to the user's current values;
	// overlay only the candidates the request supplied.
	cand := h.dl.Conf()
	if body.OutputDir != nil {
		cand.OutputDir = *body.OutputDir
	}
	if body.FileTemplate != nil {
		cand.FileTemplate = *body.FileTemplate
	}
	if body.FileGroupTemplate != nil {
		cand.FileGroupTemplate = *body.FileGroupTemplate
	}

	root := h.dl.Root()
	outDir, single, multi, errs := download.PreviewNaming(cand, root, h.dl.Home(), root)
	if errs == nil {
		errs = map[string]string{}
	}
	writeJSON(w, http.StatusOK, NamingPreviewResponse{
		OutputDir:  outDir,
		SinglePage: single,
		MultiPage:  multi,
		Fields:     errs,
	})
}

func viewToWire(v *config.View) ConfigView {
	srcs := make(map[string]ConfigSource, len(v.Sources))
	for k, s := range v.Sources {
		srcs[k] = ConfigSource(s)
	}
	return ConfigView{
		Effective:      v.Effective,
		File:           v.File,
		Sources:        srcs,
		PendingRestart: v.PendingRestart,
		SchemaVersion:  v.SchemaVersion,
	}
}
