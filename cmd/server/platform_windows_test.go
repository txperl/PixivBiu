//go:build windows

package main

import (
	"errors"
	"net"
	"os"
	"syscall"
	"testing"

	"golang.org/x/sys/windows"
)

// TestIsPortUnavailable_Windows locks in the Windows-only classification.
// The WSAEADDRINUSE case reproduces the exact error chain net.Listen yields
// for a busy port (OpError → SyscallError → Errno 10048) — the chain that a
// syscall.EADDRINUSE comparison silently failed to match, disabling the
// fallback walk. TestListenWithFallback_WalksPastBusyPort complements this
// with a real double-listen once CI runs the suite on Windows.
func TestIsPortUnavailable_Windows(t *testing.T) {
	wsaeAddrInUse := &net.OpError{
		Op:  "listen",
		Net: "tcp",
		Err: &os.SyscallError{Syscall: "bind", Err: windows.WSAEADDRINUSE},
	}
	if !isPortUnavailable(wsaeAddrInUse) {
		t.Errorf("WSAEADDRINUSE bind error: want isPortUnavailable=true, got false")
	}

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
