package api

import (
	"net/http"
	"time"

	"github.com/txperl/PixivBiu/internal/inbox"
)

// GetEvents opens an SSE subscription. The `topics` query parameter
// is parsed inside inbox.ServeSSE (comma-separated, empty = all).
func (h *APIHandler) GetEvents(w http.ResponseWriter, r *http.Request, _ GetEventsParams) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	inbox.ServeSSE(h.hub, time.Duration(h.heartbeat.Load()), w, r)
}
