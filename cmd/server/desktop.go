package main

import (
	"bufio"
	"context"
	"errors"
	"io"
)

// Versioned private parent/child protocol, mirrored by desktop/src/core-supervisor.ts.
// The marker is also checked in staged binaries before packaging (not an auth token).
const desktopProtocolMarker = "pixivbiu-desktop/1"
const desktopReadyMarker = "pixivbiu-desktop/1 ready"
const desktopRestartExitCode = 75
const desktopPortBusyExitCode = 76

var errDesktopRestart = errors.New("desktop restart requested")
var desktopManagedVersion int

// A private stdin pipe is the parent's lifetime lease. EOF, a read failure or a
// stop command all enter the normal shutdown path. Bound malformed input; no
// public HTTP endpoint or renderer IPC capability is needed to stop the core.
func watchDesktopParent(input io.Reader, cancel context.CancelFunc) {
	defer cancel()
	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 256), 256)
	for scanner.Scan() {
		if scanner.Text() == "stop" {
			return
		}
	}
}
