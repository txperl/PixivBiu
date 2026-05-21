// Package auth holds short-lived authentication state that doesn't belong in
// the persistent token store. Today that's the PKCE verifier issued for the
// browser-driven Pixiv OAuth flow: the backend generates the verifier (so it
// never leaves the server), hands the client a `state` handle plus the login
// URL, and looks the verifier back up when the client posts the auth code.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

// DefaultTTL is how long an issued PKCE state stays usable. Pixiv's hosted
// login page doesn't take longer than this even with 2FA + captcha; expired
// entries are dropped lazily on Consume.
const DefaultTTL = 10 * time.Minute

// DefaultMaxEntries caps the in-memory map. PixivBiu is single-user and
// self-hosted, so this only protects against pathological client behaviour
// (e.g. a script that calls /auth/oauth/start in a loop). Oldest entries are
// evicted when the cap is reached.
const DefaultMaxEntries = 64

// ErrUnknownState is returned by Consume when the supplied state is missing
// or expired. Handlers translate it into HTTP 400.
var ErrUnknownState = errors.New("auth: unknown or expired oauth state")

type entry struct {
	verifier  string
	createdAt time.Time
	expiresAt time.Time
}

// Store keeps issued PKCE verifiers in memory, keyed by an opaque state id.
type Store struct {
	mu      sync.Mutex
	entries map[string]entry
	ttl     time.Duration
	cap     int
	now     func() time.Time
}

// NewStore returns a Store with DefaultTTL / DefaultMaxEntries.
func NewStore() *Store {
	return &Store{
		entries: make(map[string]entry),
		ttl:     DefaultTTL,
		cap:     DefaultMaxEntries,
		now:     time.Now,
	}
}

// Issue generates a fresh (state, verifier, challenge) triple and stores the
// verifier indexed by state. The caller hands `state` and `challenge` to the
// browser and keeps the verifier on the server.
func (s *Store) Issue() (state, verifier, challenge string, err error) {
	state, err = randomURLToken(32)
	if err != nil {
		return "", "", "", err
	}
	verifier, err = randomURLToken(32)
	if err != nil {
		return "", "", "", err
	}
	sum := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(sum[:])

	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gcLocked(now)
	if len(s.entries) >= s.cap {
		s.evictOldestLocked()
	}
	s.entries[state] = entry{verifier: verifier, createdAt: now, expiresAt: now.Add(s.ttl)}
	return state, verifier, challenge, nil
}

// Consume looks up and removes the verifier for state. Returns ErrUnknownState
// when the entry is missing or expired. Single-use by design — replays fail.
func (s *Store) Consume(state string) (string, error) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.gcLocked(now)
	e, ok := s.entries[state]
	if !ok {
		return "", ErrUnknownState
	}
	delete(s.entries, state)
	if now.After(e.expiresAt) {
		return "", ErrUnknownState
	}
	return e.verifier, nil
}

func (s *Store) gcLocked(now time.Time) {
	for k, e := range s.entries {
		if now.After(e.expiresAt) {
			delete(s.entries, k)
		}
	}
}

func (s *Store) evictOldestLocked() {
	var (
		oldestKey string
		oldestAt  time.Time
		first     = true
	)
	for k, e := range s.entries {
		if first || e.createdAt.Before(oldestAt) {
			oldestKey, oldestAt, first = k, e.createdAt, false
		}
	}
	if oldestKey != "" {
		delete(s.entries, oldestKey)
	}
}

// randomURLToken returns a base64url-no-padding token of `n` random bytes.
// 32 bytes → 43 characters, well within RFC 7636's 43–128 range for verifiers
// and high enough entropy for state.
func randomURLToken(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
