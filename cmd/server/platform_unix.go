//go:build !windows

package main

// Non-Windows platform shims: the port-busy classification, the
// fatal-exit pause, and the self-restart. Windows needs different
// implementations of all three (see platform_windows.go).

import (
	"errors"
	"os"
	"syscall"
)

// isPortUnavailable reports whether a net.Listen error means the port is taken
// and the caller should walk to the next one. On Unix a busy port is EADDRINUSE.
func isPortUnavailable(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE)
}

// pauseOnExit is a no-op off Windows: terminals there persist after the process
// exits, so a fatal message stays on screen on its own.
func pauseOnExit() {}

// reexec replaces the current process image with a fresh invocation of
// the same binary, which reloads settings.json on boot. The PID is
// preserved and open file descriptors plus the environment are
// inherited. On success it does not return — the new image takes over;
// it only returns when the exec itself fails.
func reexec() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return syscall.Exec(exe, os.Args, os.Environ())
}
