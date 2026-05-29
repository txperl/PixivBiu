// Settings persistence: a single JSON file (./usr/settings.json by default)
// holding the diff between effective config and built-in defaults.
// The file is the only writable layer; defaults and env always layer
// above it (env wins). Atomic writes mirror internal/state/state.go.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"sync"

	"github.com/txperl/PixivBiu/internal/atomicfile"
)

// Store reads and writes the settings JSON file atomically.
// The on-disk shape is nested JSON keyed by koanf names
// (e.g. {"download": {"max_concurrent": 8}}). The flat dotted-key form
// used internally by koanf is produced/consumed by flatten/unflatten.
type Store struct {
	path string
	mu   sync.Mutex
}

func NewStore(path string) *Store {
	return &Store{path: path}
}

func (s *Store) Path() string { return s.path }

// Load returns the file layer as a flat dotted-key map.
// A missing file is the first-run case and returns an empty map, nil.
func (s *Store) Load() (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return map[string]any{}, nil
		}
		return nil, fmt.Errorf("read settings file %q: %w", s.path, err)
	}
	if len(data) == 0 {
		return map[string]any{}, nil
	}
	var nested map[string]any
	if err := json.Unmarshal(data, &nested); err != nil {
		return nil, fmt.Errorf("parse settings file %q: %w", s.path, err)
	}
	return flatten("", nested), nil
}

// Save writes the flat dotted-key layer to disk, nesting it first.
// An empty layer truncates the file to "{}" rather than deleting it,
// keeping the file's existence as a "managed by app" signal.
func (s *Store) Save(flatLayer map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	nested := unflatten(flatLayer)
	data, err := json.MarshalIndent(nested, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal settings: %w", err)
	}
	data = append(data, '\n')

	if err := atomicfile.Write(s.path, data); err != nil {
		return fmt.Errorf("save settings file: %w", err)
	}
	return nil
}

// flatten lowers a nested map into dotted-key form, e.g.
//
//	{"download": {"max_concurrent": 8}}  →  {"download.max_concurrent": 8}
//
// Non-map values terminate the descent.
func flatten(prefix string, v any) map[string]any {
	out := map[string]any{}
	m, ok := v.(map[string]any)
	if !ok {
		if prefix != "" {
			out[prefix] = v
		}
		return out
	}
	for k, val := range m {
		key := k
		if prefix != "" {
			key = prefix + "." + k
		}
		if sub, ok := val.(map[string]any); ok {
			for kk, vv := range flatten(key, sub) {
				out[kk] = vv
			}
		} else {
			out[key] = val
		}
	}
	return out
}

// unflatten inverts flatten. Conflicting writes (e.g. "a" and "a.b")
// resolve last-write-wins on the leaf; structural collisions are not
// possible because the caller always works in dotted-key space.
func unflatten(m map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range m {
		if k == "" {
			continue
		}
		parts := strings.Split(k, ".")
		cur := out
		for i, p := range parts {
			if i == len(parts)-1 {
				cur[p] = v
				continue
			}
			next, ok := cur[p].(map[string]any)
			if !ok {
				next = map[string]any{}
				cur[p] = next
			}
			cur = next
		}
	}
	return out
}
