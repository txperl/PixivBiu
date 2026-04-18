// Package state persists the Pixiv auth token state to a JSON file on disk.
// The file is the single source of truth for refresh_token / access_token —
// the application config never holds tokens.
package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Token is the persisted auth state.
type Token struct {
	RefreshToken         string    `json:"refresh_token"`
	AccessToken          string    `json:"access_token,omitempty"`
	AccessTokenExpiresAt time.Time `json:"access_token_expires_at,omitzero"`
	UserID               int64     `json:"user_id,omitempty"`
	UserName             string    `json:"user_name,omitempty"`
}

// IsEmpty reports whether the token has no usable data.
func (t Token) IsEmpty() bool {
	return t.RefreshToken == "" && t.AccessToken == ""
}

// Store reads and writes a Token atomically from/to a file path.
// Safe for concurrent use.
type Store struct {
	path string
	mu   sync.Mutex
}

// NewStore returns a store bound to path. The file is not opened here.
func NewStore(path string) *Store {
	return &Store{path: path}
}

// Path returns the file path this store manages.
func (s *Store) Path() string { return s.path }

// Load reads the current token from disk. When the file does not exist,
// it returns a zero-valued Token and no error — this is the "first run" case.
func (s *Store) Load() (Token, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return Token{}, nil
		}
		return Token{}, fmt.Errorf("read state file %q: %w", s.path, err)
	}
	var t Token
	if err := json.Unmarshal(data, &t); err != nil {
		return Token{}, fmt.Errorf("parse state file %q: %w", s.path, err)
	}
	return t, nil
}

// Save writes the token to disk atomically (temp file + rename).
// The parent directory is created with 0700 if missing; the file is written 0600.
func (s *Store) Save(t Token) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create state dir %q: %w", dir, err)
	}

	data, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal token: %w", err)
	}

	tmp, err := os.CreateTemp(dir, ".state-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp state file: %w", err)
	}
	tmpName := tmp.Name()
	// On any failure past this point, remove the leftover temp file.
	cleanup := func() { _ = os.Remove(tmpName) }

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("write temp state file: %w", err)
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("chmod temp state file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close temp state file: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		cleanup()
		return fmt.Errorf("rename state file: %w", err)
	}
	return nil
}

// Clear removes any existing state file. Missing file is not an error.
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove state file %q: %w", s.path, err)
	}
	return nil
}
