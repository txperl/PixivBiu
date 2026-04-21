package inbox

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ServeSSE handles an SSE subscription over an HTTP request. The
// client supplies a comma-separated `topics` query parameter to
// filter (empty = all), and optionally a Last-Event-ID header for
// replay. The response stream continues until the client disconnects
// or hub.drop is called on the subscription.
func ServeSSE(h *Hub, heartbeat time.Duration, w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Opt out of the server's WriteTimeout — SSE is long-lived.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable reverse-proxy buffering (nginx, traefik)

	topics := parseTopics(r.URL.Query().Get("topics"))
	lastID := r.Header.Get("Last-Event-ID")

	ch, replay, evicted, cancel := h.Subscribe(topics, lastID)
	defer cancel()

	w.WriteHeader(http.StatusOK)

	// If the client's Last-Event-ID is no longer in the ring, tell
	// them to re-fetch state. We publish this only to THIS client,
	// not through the hub, because a broadcast resync would cause
	// every other connected client to also reload — incorrect.
	if evicted {
		writeEvent(w, Envelope{
			ID:    newEventID(),
			Ts:    time.Now().UTC(),
			Topic: "system",
			Type:  "resync",
			Data:  json.RawMessage(`{"reason":"buffer_evicted"}`),
		})
		flusher.Flush()
	}

	for _, env := range replay {
		writeEvent(w, env)
	}
	flusher.Flush()

	if heartbeat <= 0 {
		heartbeat = 15 * time.Second
	}
	ticker := time.NewTicker(heartbeat)
	defer ticker.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Comment line: keeps proxies and browsers from idling out.
			if _, err := fmt.Fprint(w, ":keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case env, open := <-ch:
			if !open {
				return
			}
			if err := writeEvent(w, env); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// parseTopics turns "download,auth" into ["download", "auth"].
// Returns nil (= match all) for the empty string.
func parseTopics(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// writeEvent writes a single envelope in SSE frame format. The event
// `id:` line is set so browsers can send Last-Event-ID on reconnect.
// The `event:` line carries `<topic>.<type>` so client EventSource
// addEventListener("download.task.progress", ...) works directly.
func writeEvent(w http.ResponseWriter, env Envelope) error {
	payload, err := json.Marshal(env)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %s\nevent: %s.%s\ndata: %s\n\n", env.ID, env.Topic, env.Type, payload); err != nil {
		return err
	}
	return nil
}
