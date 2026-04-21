package api

import (
	"net/http"

	"github.com/txperl/PixivBiu/internal/inbox"
)

// GetEvents opens an SSE subscription. The `topics` query parameter
// is parsed inside inbox.ServeSSE (comma-separated, empty = all).
func (h *APIHandler) GetEvents(w http.ResponseWriter, r *http.Request, _ GetEventsParams) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	inbox.ServeSSE(h.hub, h.heartbeat, w, r)
}
