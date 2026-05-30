// Package browser opens a URL in the user's default browser, best-effort.
package browser

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

// Open launches the system default browser at url and returns once the
// launcher has started (it does not wait for the browser). On headless
// Linux/BSD (no DISPLAY and no WAYLAND_DISPLAY) it is a no-op returning nil.
// Opening a browser is never fatal; callers log the error and continue.
func Open(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		// rundll32 sidesteps cmd.exe quoting pitfalls with & and ? in URLs.
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default: // linux, *bsd
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return nil // headless: skip silently
		}
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("open browser (%s): %w", runtime.GOOS, err)
	}
	go func() { _ = cmd.Wait() }() // reap the fast-exiting launcher
	return nil
}
