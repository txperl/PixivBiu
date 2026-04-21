package inbox

import (
	"encoding/json"
	"sync"
	"time"
)

// Hub is an in-memory pub-sub with a fixed-size event ring buffer
// for Last-Event-ID replay. Safe for concurrent use.
type Hub struct {
	mu   sync.RWMutex
	ring []Envelope // len == cap; nil slots are zero Envelope{}
	cap  int
	// count is the total number of events ever published. The tail is
	// at count-1; the oldest retained event is at max(0, count-cap).
	count uint64
	subs  map[*subscriber]struct{}
}

// subscriber holds one client's delivery channel and its topic filter.
// The channel is buffered; on overflow we drop the subscriber (close
// its chan) rather than block Publish. The client will reconnect and
// pick up via Last-Event-ID or system.resync.
//
// sendMu guards the "is this still deliverable?" decision and the
// close of ch, so concurrent Publish callers can never double-close
// or send on a closed channel. It is a per-subscriber lock so
// different clients do not contend.
type subscriber struct {
	sendMu sync.Mutex
	closed bool
	ch     chan Envelope
	topics map[string]struct{} // empty = match all
}

// NewHub creates a hub with a ring buffer of the given capacity.
// A capacity < 1 is silently raised to 1.
func NewHub(capacity int) *Hub {
	if capacity < 1 {
		capacity = 1
	}
	return &Hub{
		ring: make([]Envelope, capacity),
		cap:  capacity,
		subs: make(map[*subscriber]struct{}),
	}
}

// Publish stamps the event with an ID + timestamp, appends it to the
// ring buffer, and fans it out to all matching subscribers. Never
// blocks: slow subscribers are disconnected.
func (h *Hub) Publish(topic, typ string, data any) {
	payload, err := json.Marshal(data)
	if err != nil {
		payload = []byte(`null`)
	}
	env := Envelope{
		ID:    newEventID(),
		Ts:    time.Now().UTC(),
		Topic: topic,
		Type:  typ,
		Data:  payload,
	}

	h.mu.Lock()
	h.ring[int(h.count%uint64(h.cap))] = env
	h.count++
	// Snapshot subscribers to deliver outside the lock.
	targets := make([]*subscriber, 0, len(h.subs))
	for s := range h.subs {
		if len(s.topics) > 0 {
			if _, ok := s.topics[topic]; !ok {
				continue
			}
		}
		targets = append(targets, s)
	}
	h.mu.Unlock()

	for _, s := range targets {
		if !s.deliver(env) {
			// Subscriber is slow and has been marked closed; remove
			// it from the hub so future Publishes don't see it.
			h.removeSub(s)
		}
	}
}

// deliver attempts a non-blocking send to the subscriber. Returns
// false when the subscriber was dropped (either just now by us
// because its buffer was full, or earlier by another goroutine). The
// per-subscriber lock makes the "check closed → send-or-close"
// sequence atomic, which is what removes the send-on-closed-channel
// panic under concurrent Publish.
func (s *subscriber) deliver(env Envelope) bool {
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	if s.closed {
		return false
	}
	select {
	case s.ch <- env:
		return true
	default:
		s.closed = true
		close(s.ch)
		return false
	}
}

// Subscribe registers a new subscriber and returns:
//   - ch: channel of future events matching topics
//   - replay: backlog of events after lastEventID (nil if evicted)
//   - evicted: true when lastEventID is set but not in the ring — the
//     caller should emit a `system.resync` event before streaming
//   - cancel: releases the subscription
//
// If topics is empty, the subscriber matches all topics.
// If lastEventID is empty, replay is nil and evicted is false.
func (h *Hub) Subscribe(topics []string, lastEventID string) (ch <-chan Envelope, replay []Envelope, evicted bool, cancel func()) {
	s := &subscriber{
		ch:     make(chan Envelope, 64),
		topics: make(map[string]struct{}, len(topics)),
	}
	for _, t := range topics {
		if t != "" {
			s.topics[t] = struct{}{}
		}
	}

	h.mu.Lock()
	replay, evicted = h.snapshotSinceLocked(lastEventID, s.topics)
	h.subs[s] = struct{}{}
	h.mu.Unlock()

	return s.ch, replay, evicted, func() { h.drop(s) }
}

// snapshotSinceLocked scans the ring buffer for events newer than
// lastEventID. If lastEventID is empty, returns no backlog and
// evicted=false. If lastEventID is set but not found in the ring,
// returns nil, true.
//
// MUST be called with h.mu held.
func (h *Hub) snapshotSinceLocked(lastEventID string, topics map[string]struct{}) ([]Envelope, bool) {
	if lastEventID == "" {
		return nil, false
	}

	size := h.cap
	if h.count < uint64(size) {
		size = int(h.count)
	}
	start := h.count - uint64(size)

	// Find the index in the ring matching lastEventID.
	foundIdx := -1
	for i := 0; i < size; i++ {
		pos := int((start + uint64(i)) % uint64(h.cap))
		if h.ring[pos].ID == lastEventID {
			foundIdx = i
			break
		}
	}
	if foundIdx == -1 {
		// Either evicted or the client sent a bogus ID. Either way
		// the correct response is resync.
		return nil, true
	}

	// Replay everything AFTER foundIdx.
	replay := make([]Envelope, 0, size-foundIdx-1)
	for i := foundIdx + 1; i < size; i++ {
		pos := int((start + uint64(i)) % uint64(h.cap))
		env := h.ring[pos]
		if len(topics) > 0 {
			if _, ok := topics[env.Topic]; !ok {
				continue
			}
		}
		replay = append(replay, env)
	}
	return replay, false
}

// drop releases a subscription: it closes the delivery channel (if
// not already closed) and removes the subscriber from the hub. Safe
// to call multiple times and concurrently with Publish.
func (h *Hub) drop(s *subscriber) {
	s.sendMu.Lock()
	if !s.closed {
		s.closed = true
		close(s.ch)
	}
	s.sendMu.Unlock()
	h.removeSub(s)
}

// removeSub deletes the subscriber from the hub's index. The channel
// close is handled separately via the subscriber's sendMu.
func (h *Hub) removeSub(s *subscriber) {
	h.mu.Lock()
	delete(h.subs, s)
	h.mu.Unlock()
}
