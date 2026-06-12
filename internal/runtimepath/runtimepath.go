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

// DataRoot returns the base directory for all runtime files: the
// config/state/index files, the image cache, and the default download
// output_dir — every path that anchors through Root(). An explicit
// override relocates the whole tree at once: the -data-dir flag value,
// or the PIXIVBIU_DATA_DIR env var when that flag is empty. The override
// is made absolute so a relative value doesn't drift with the launch CWD.
//
// With no override it falls back to Root() (the executable's directory),
// preserving the portable single-binary layout. Desktop builds point the
// override at the OS user-data dir (Electron's app.getPath("userData")),
// so state lives under e.g. ~/Library/Application Support/PixivBiu instead
// of inside the read-only .app bundle.
func DataRoot(override string) string {
	if override == "" {
		override = os.Getenv("PIXIVBIU_DATA_DIR")
	}
	if override == "" {
		return Root()
	}
	if abs, err := filepath.Abs(override); err == nil {
		return abs
	}
	return override
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
