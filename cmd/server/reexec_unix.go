//go:build !windows

package main

import (
	"os"
	"syscall"
)

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
