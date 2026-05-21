package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"testing"
	"time"
)

func TestStore_IssueAndConsume(t *testing.T) {
	s := NewStore()

	state, verifier, challenge, err := s.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if state == "" || verifier == "" || challenge == "" {
		t.Fatalf("Issue returned empty fields: state=%q verifier=%q challenge=%q", state, verifier, challenge)
	}
	if len(verifier) < 43 {
		t.Errorf("verifier too short for RFC 7636 (got %d, want >=43)", len(verifier))
	}
	// challenge must equal base64url(sha256(verifier)).
	sum := sha256.Sum256([]byte(verifier))
	want := base64.RawURLEncoding.EncodeToString(sum[:])
	if challenge != want {
		t.Errorf("challenge mismatch:\n got %q\nwant %q", challenge, want)
	}

	got, err := s.Consume(state)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if got != verifier {
		t.Errorf("Consume returned different verifier")
	}

	// Single-use: a replay must fail.
	if _, err := s.Consume(state); !errors.Is(err, ErrUnknownState) {
		t.Errorf("replay: want ErrUnknownState, got %v", err)
	}
}

func TestStore_ConsumeUnknown(t *testing.T) {
	s := NewStore()
	if _, err := s.Consume("nope"); !errors.Is(err, ErrUnknownState) {
		t.Errorf("want ErrUnknownState, got %v", err)
	}
}

func TestStore_Expired(t *testing.T) {
	s := NewStore()
	s.ttl = time.Millisecond
	now := time.Unix(1_700_000_000, 0)
	s.now = func() time.Time { return now }

	state, _, _, err := s.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	// Jump past the TTL.
	now = now.Add(time.Hour)
	if _, err := s.Consume(state); !errors.Is(err, ErrUnknownState) {
		t.Errorf("want ErrUnknownState after TTL, got %v", err)
	}
}

func TestStore_CapEvictsOldest(t *testing.T) {
	s := NewStore()
	s.cap = 3
	base := time.Unix(1_700_000_000, 0)
	step := time.Millisecond
	tick := 0
	s.now = func() time.Time {
		t := base.Add(time.Duration(tick) * step)
		tick++
		return t
	}

	// Issue 3 -> all fit.
	keys := make([]string, 0, 4)
	for i := 0; i < 3; i++ {
		k, _, _, err := s.Issue()
		if err != nil {
			t.Fatalf("Issue: %v", err)
		}
		keys = append(keys, k)
	}
	// Issue a 4th -> the oldest (keys[0]) must be evicted.
	k4, _, _, err := s.Issue()
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if _, err := s.Consume(keys[0]); !errors.Is(err, ErrUnknownState) {
		t.Errorf("expected oldest key to be evicted, but Consume returned %v", err)
	}
	// The newer keys still resolve.
	for _, k := range []string{keys[1], keys[2], k4} {
		if _, err := s.Consume(k); err != nil {
			t.Errorf("expected key %q to still be available, got %v", k, err)
		}
	}
}
