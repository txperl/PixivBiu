//go:build darwin

package sysproxy

import (
	"context"
	"os/exec"
)

// detectSystem reads macOS's system-wide proxy configuration via `scutil
// --proxy`. That reflects the "System Settings ▸ Network ▸ … ▸ Proxies" GUI
// toggles, which a process's HTTP(S)_PROXY env vars never see. We shell out
// rather than call the SystemConfiguration C API on purpose: it keeps the
// package pure Go so the CGO_ENABLED=0 cross-compile keeps working. A failure
// (scutil missing, ctx timeout) yields no candidates, not an error — Detect's
// env fallback still applies.
func detectSystem(ctx context.Context) []string {
	out, err := exec.CommandContext(ctx, "scutil", "--proxy").Output()
	if err != nil {
		return nil
	}
	return parseScutil(string(out))
}
