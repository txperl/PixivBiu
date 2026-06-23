//go:build windows

package main

import (
	"errors"
	"net"
	"os"
	"syscall"
	"testing"
)

// TestIsPortUnavailable_Windows locks in the Windows-only classification that
// the cross-platform integration tests can't exercise on non-Windows CI: a
// WSAEACCES bind error (an OS-excluded/reserved port) must count as "port taken"
// so listenWithFallback walks to the next port, while an unrelated error must
// not. WSAEADDRINUSE (== syscall.EADDRINUSE) is already covered by
// TestListenWithFallback_WalksPastBusyPort.
func TestIsPortUnavailable_Windows(t *testing.T) {
	wsaeAccess := &net.OpError{
		Op:  "listen",
		Net: "tcp",
		Err: &os.SyscallError{Syscall: "bind", Err: syscall.WSAEACCES},
	}
	if !isPortUnavailable(wsaeAccess) {
		t.Errorf("WSAEACCES bind error: want isPortUnavailable=true, got false")
	}

	if isPortUnavailable(errors.New("boom")) {
		t.Errorf("unrelated error: want isPortUnavailable=false, got true")
	}
}
