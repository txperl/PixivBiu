package inbox

import (
	"sync"
	"testing"
	"time"
)

func drainAvailable(ch <-chan Envelope) []Envelope {
	var out []Envelope
	for {
		select {
		case env, ok := <-ch:
			if !ok {
				return out
			}
			out = append(out, env)
		case <-time.After(20 * time.Millisecond):
			return out
		}
	}
}

func TestHub_SubscribeReceivesLiveEvents(t *testing.T) {
	h := NewHub(8)
	ch, replay, evicted, cancel := h.Subscribe(nil, "")
	defer cancel()
	if evicted {
		t.Fatal("no Last-Event-ID should never evict")
	}
	if len(replay) != 0 {
		t.Errorf("replay should be empty, got %d", len(replay))
	}
	h.Publish("download", "task.started", map[string]any{"job_id": "j1"})
	got := drainAvailable(ch)
	if len(got) != 1 || got[0].Topic != "download" || got[0].Type != "task.started" {
		t.Errorf("unexpected events: %+v", got)
	}
}

func TestHub_TopicFilter(t *testing.T) {
	h := NewHub(8)
	ch, _, _, cancel := h.Subscribe([]string{"download"}, "")
	defer cancel()

	h.Publish("auth", "login", nil)
	h.Publish("download", "task.progress", nil)
	got := drainAvailable(ch)
	if len(got) != 1 || got[0].Topic != "download" {
		t.Errorf("expected only download events, got %+v", got)
	}
}

func TestHub_ReplayAfterLastEventID(t *testing.T) {
	h := NewHub(8)
	h.Publish("download", "a", nil)
	h.Publish("download", "b", nil)
	h.Publish("download", "c", nil)

	// Ask for events after "b"; should get "c" replay.
	h.mu.RLock()
	midID := h.ring[1].ID // the second event = b
	h.mu.RUnlock()

	_, replay, evicted, cancel := h.Subscribe(nil, midID)
	defer cancel()
	if evicted {
		t.Fatal("mid ID should not be evicted in a size-8 ring after 3 events")
	}
	if len(replay) != 1 || replay[0].Type != "c" {
		t.Errorf("replay: want [c], got %+v", replay)
	}
}

func TestHub_EvictedLastEventID(t *testing.T) {
	h := NewHub(4)
	for range 10 {
		h.Publish("download", "tick", nil)
	}
	_, _, evicted, cancel := h.Subscribe(nil, "DEFINITELY_NOT_IN_RING")
	defer cancel()
	if !evicted {
		t.Fatal("unknown Last-Event-ID must be flagged as evicted")
	}
}

func TestHub_SlowSubscriberDropped(t *testing.T) {
	h := NewHub(8)
	ch, _, _, _ := h.Subscribe(nil, "")
	// Flood past the 64-slot channel buffer without reading.
	for range 200 {
		h.Publish("download", "flood", nil)
	}
	// Give the hub a moment to recognise overflow and close the chan.
	time.Sleep(10 * time.Millisecond)

	// At least one receive should return with ok=false (channel closed).
	closed := false
	for range 300 {
		select {
		case _, ok := <-ch:
			if !ok {
				closed = true
			}
		default:
			// channel empty; keep trying a bit more
			time.Sleep(1 * time.Millisecond)
		}
		if closed {
			break
		}
	}
	if !closed {
		t.Error("expected slow subscriber channel to be closed after overflow")
	}
}

// TestHub_ConcurrentPublishDropIsSafe covers the close race between
// multiple Publish goroutines and a drop path: when a subscriber's
// buffer overflows, the hub must close its channel at most once and
// must not panic with "send on closed channel" under concurrent
// Publish. Prior to the per-subscriber sendMu/closed guard, running
// this under `go test -race` could crash.
func TestHub_ConcurrentPublishDropIsSafe(t *testing.T) {
	h := NewHub(8)
	// Buffer=64 from Subscribe's default; we'll flood past it from
	// many publishers simultaneously and never drain.
	ch, _, _, _ := h.Subscribe(nil, "")

	const (
		publishers       = 16
		publishesEachRun = 500
	)

	var wg sync.WaitGroup
	wg.Add(publishers)
	for range publishers {
		go func() {
			defer wg.Done()
			for range publishesEachRun {
				h.Publish("download", "flood", nil)
			}
		}()
	}
	wg.Wait()

	// Channel must be closed exactly once; draining should eventually
	// see ok=false without panicking.
	deadline := time.Now().Add(500 * time.Millisecond)
	closed := false
	for time.Now().Before(deadline) {
		select {
		case _, ok := <-ch:
			if !ok {
				closed = true
			}
		default:
			time.Sleep(time.Millisecond)
		}
		if closed {
			break
		}
	}
	if !closed {
		t.Fatal("expected subscriber channel to be closed after concurrent overflow")
	}
}
