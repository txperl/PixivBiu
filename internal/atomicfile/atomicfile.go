// Package atomicfile writes small files atomically.
//
// All writers in this app (settings.json, state.json, downloads.json)
// must replace their files in one step so a crash mid-write can't leave
// a half-written JSON blob. Each writer used to inline the same
// temp-file + chmod + rename + cleanup dance; this package is that
// dance, once.
package atomicfile

import (
	"fmt"
	"os"
	"path/filepath"
)

// Write replaces path with data atomically. The parent directory is
// created with mode 0o700 if missing; the file is written with mode
// 0o600 — both match the on-disk hardening these callers already had.
//
// Intended for small payloads buffered in memory (a JSON state file,
// typically a few KB). Don't use for arbitrarily-large data.
func Write(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create dir %q: %w", dir, err)
	}

	tmp, err := os.CreateTemp(dir, ".atomic-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp file in %q: %w", dir, err)
	}
	tmpName := tmp.Name()
	// Remove leftover temp on any failure past this point.
	cleanup := func() { _ = os.Remove(tmpName) }

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("write temp %q: %w", tmpName, err)
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("chmod temp %q: %w", tmpName, err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close temp %q: %w", tmpName, err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		cleanup()
		return fmt.Errorf("rename %q → %q: %w", tmpName, path, err)
	}
	return nil
}
