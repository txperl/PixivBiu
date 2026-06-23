//go:build !windows

package main

import (
	"errors"
	"syscall"
)

// isPortUnavailable reports whether a net.Listen error means the port is taken
// and the caller should walk to the next one. On Unix a busy port is EADDRINUSE.
func isPortUnavailable(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE)
}
