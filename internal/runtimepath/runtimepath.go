// Package runtimepath resolves where the process is running from and
// anchors relative paths to it, so the same binary reads and writes the
// same files regardless of the launch CWD. It is the single source of
// truth for "where am I running": both the download output_dir and the
// config/state/index files anchor through here.
package runtimepath

import (
	"os"
	"path/filepath"
	"regexp"
)

// Root returns the directory of the running executable, or "." on
// error. It is the anchor for a relative download.output_dir as well as
// the config/state/index files.
//
// `go run` places the built binary under a `go-build*` temp directory
// that the toolchain wipes on process exit. Anchoring there would
// silently destroy dev-mode artefacts and leave persisted stores
// pointing at missing files, so we detect that layout and fall back to
// the process CWD (which under `make dev` is the repo root).
func Root() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	cwd, cwdErr := os.Getwd()
	if cwdErr != nil {
		cwd = "."
	}
	return resolveRoot(exe, cwd)
}

// goBuildTempRE matches Go's temp-build directory segment:
// `os.MkdirTemp(..., "go-build")` produces `go-build` + decimal digits.
// Anchoring on the bare prefix would catch install paths like
// `/opt/go-builds/...`; requiring the digit suffix scopes us to the
// real toolchain layout.
var goBuildTempRE = regexp.MustCompile(`(^|/)go-build[0-9]+(/|$)`)

func resolveRoot(exe, cwd string) string {
	dir := filepath.Dir(exe)
	if goBuildTempRE.MatchString(filepath.ToSlash(dir)) {
		return cwd
	}
	return dir
}

// Anchor resolves p against root so it does not drift with the process
// CWD. An absolute or empty p is returned unchanged; a relative p is
// joined onto root.
func Anchor(root, p string) string {
	if p == "" || filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(root, p)
}
