package api

import "net/http"

// GetI18n returns the configured `app.language` plus the locale the
// running translator bound — both pinned at boot (restart-required), so
// the frontend can mirror the backend without sniffing the browser.
func (h *APIHandler) GetI18n(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, I18nStatus{
		Configured: I18nStatusConfigured(h.cfgMgr.Config().App.Language),
		Locale:     I18nStatusLocale(h.tr.Locale()),
	})
}
