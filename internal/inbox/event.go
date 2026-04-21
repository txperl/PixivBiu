// Package inbox is a small in-process pub-sub with an SSE dispatcher.
//
// Subsystems publish Envelopes to a Hub; HTTP clients subscribe via
// GET /events and receive Server-Sent Events. The hub keeps a short
// in-memory ring buffer so clients reconnecting within the window can
// replay missed events using the standard Last-Event-ID header. When
// a client's Last-Event-ID has been evicted, the handler emits a
// single `system.resync` event so the client knows to refetch state
// from the authoritative REST endpoints (state-authoritative model).
//
// This package is deliberately transport-agnostic on the publish side:
// Hub exposes a Publisher interface so downstream modules (e.g. the
// download manager) don't need to know SSE exists.
package inbox

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"sync/atomic"
	"time"
)

// Envelope is the on-the-wire shape of every published event.
//
// ID is monotonically increasing across a single process lifetime so
// it can double as SSE's Last-Event-ID. Ts is populated at publish
// time, not construction time.
type Envelope struct {
	ID    string          `json:"id"`
	Ts    time.Time       `json:"ts"`
	Topic string          `json:"topic"`
	Type  string          `json:"type"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// Publisher is the narrow interface downstream modules see. Keeping
// this separate from *Hub lets tests supply a recording fake without
// spinning up the real ring buffer.
type Publisher interface {
	Publish(topic, typ string, data any)
}

// idSeq is the per-process monotonic counter behind newEventID. It
// starts at a random offset so IDs from different runs do not collide
// within a client cache, which would fool Last-Event-ID replay.
var idSeq atomic.Uint64

func init() {
	var seed [8]byte
	_, _ = rand.Read(seed[:])
	idSeq.Store(binary.BigEndian.Uint64(seed[:]))
}

// newEventID returns a new lexicographically-sortable event ID.
// Format: 8 bytes big-endian time-millis || 8 bytes counter, base32
// (Crockford-ish, no padding). This is NOT a full ULID but is
// sufficient for Last-Event-ID matching inside a ring buffer.
func newEventID() string {
	var buf [16]byte
	binary.BigEndian.PutUint64(buf[0:8], uint64(time.Now().UnixMilli()))
	binary.BigEndian.PutUint64(buf[8:16], idSeq.Add(1))
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf[:])
}
