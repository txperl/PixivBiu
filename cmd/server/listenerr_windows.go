//go:build windows

package main

import (
	"errors"
	"syscall"
)

// isPortUnavailable reports whether a net.Listen error means the port is taken
// and the caller should walk to the next one. Windows surfaces an unusable port
// two ways: WSAEADDRINUSE (== syscall.EADDRINUSE) for a plain conflict, and
// WSAEACCES when the port lands in an OS-excluded range (Hyper-V/WSL2/Docker
// "winnat" reservations) or is held with SO_EXCLUSIVEADDRUSE. Treat both as
// "try the next port" — otherwise a reserved configured port aborts boot
// instead of falling back, which is exactly the Windows symptom we're fixing.
func isPortUnavailable(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE) || errors.Is(err, syscall.WSAEACCES)
}
