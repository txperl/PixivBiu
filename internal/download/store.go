package download

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sync"
)

// Store persists the download job index to a single JSON file
// atomically (temp file + fsync-less rename, matching the pattern
// used by internal/state.Store).
//
// The store holds the full index in memory; callers mutate the map
// and then call Save. This keeps the write amplification tied to
// state-machine transitions rather than per-chunk progress ticks.
type Store struct {
	path string
	mu   sync.Mutex
}

// snapshot is the on-disk shape: a simple map keyed by job ID plus a
// version marker for forward-compatibility.
type snapshot struct {
	Version int             `json:"version"`
	Jobs    map[string]*Job `json:"jobs"`
}

const storeVersion = 1

// NewStore binds a store to a file path. The file is not opened.
func NewStore(path string) *Store {
	return &Store{path: path}
}

// Path returns the file path this store manages.
func (s *Store) Path() string { return s.path }

// Load reads the index from disk. First run returns an empty map.
func (s *Store) Load() (map[string]*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return map[string]*Job{}, nil
		}
		return nil, fmt.Errorf("read download store %q: %w", s.path, err)
	}

	// Zero-length file = treat as first run. Can happen if an
	// earlier process died mid-write before atomic rename would
	// normally guard against that; defensive.
	if len(data) == 0 {
		return map[string]*Job{}, nil
	}

	var snap snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, fmt.Errorf("parse download store %q: %w", s.path, err)
	}
	if snap.Jobs == nil {
		snap.Jobs = map[string]*Job{}
	}
	return snap.Jobs, nil
}

// Save writes the index atomically. Caller passes the full map; this
// is cheap because jobs counts stay in the hundreds at most.
func (s *Store) Save(jobs map[string]*Job) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create download store dir %q: %w", dir, err)
	}

	data, err := json.MarshalIndent(snapshot{
		Version: storeVersion,
		Jobs:    jobs,
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal download jobs: %w", err)
	}

	tmp, err := os.CreateTemp(dir, ".downloads-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp download file: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("write temp download file: %w", err)
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("chmod temp download file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close temp download file: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		cleanup()
		return fmt.Errorf("rename download file: %w", err)
	}
	return nil
}

// SortedJobs returns jobs sorted by CreatedAt descending for stable
// listing. The output is a slice of shallow copies sharing the
// underlying Task slice — callers must not mutate tasks under their
// feet.
func SortedJobs(jobs map[string]*Job) []*Job {
	out := make([]*Job, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, j)
	}
	slices.SortFunc(out, func(a, b *Job) int {
		return b.CreatedAt.Compare(a.CreatedAt)
	})
	return out
}
