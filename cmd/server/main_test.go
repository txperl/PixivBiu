package main

import (
	"net"
	"testing"
)

// TestListenWithFallback_WalksPastBusyPort occupies a port, then asks
// listenWithFallback to bind it: it must skip the busy port and land on a
// free one. We only assert the port moved (not exactly +1) to stay
// non-flaky on machines where the next port happens to be taken too.
func TestListenWithFallback_WalksPastBusyPort(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("seed listener: %v", err)
	}
	defer busy.Close()
	port := tcpPort(busy)

	ln, err := listenWithFallback("127.0.0.1", port, true)
	if err != nil {
		t.Fatalf("listenWithFallback: %v", err)
	}
	defer ln.Close()

	if got := tcpPort(ln); got == port {
		t.Fatalf("expected fallback off busy port %d, got same", port)
	}
}

// TestListenWithFallback_DisabledFailsOnBusy asserts attempts == 1 (the dev
// backend's pinned-port mode) does NOT walk: a busy port returns an error
// instead of silently binding elsewhere.
func TestListenWithFallback_DisabledFailsOnBusy(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("seed listener: %v", err)
	}
	defer busy.Close()
	port := tcpPort(busy)

	ln, err := listenWithFallback("127.0.0.1", port, false)
	if err == nil {
		ln.Close()
		t.Fatalf("expected busy port %d to fail with fallback disabled", port)
	}
}

// TestListenWithFallback_OutOfRangePort guards the contract that a nil
// listener is never returned without an error: an out-of-range port (config
// min/max only gates PATCH, not the startup file/env layers) must fail with
// an error rather than returning (nil, nil) and panicking the caller.
func TestListenWithFallback_OutOfRangePort(t *testing.T) {
	for _, port := range []int{0, 70000} {
		ln, err := listenWithFallback("127.0.0.1", port, true)
		if ln != nil {
			ln.Close()
			t.Errorf("port %d: expected nil listener, got %v", port, ln.Addr())
		}
		if err == nil {
			t.Errorf("port %d: expected an error, got nil", port)
		}
	}
}

// TestListenWithFallback_FreePort binds directly when the port is open.
func TestListenWithFallback_FreePort(t *testing.T) {
	// Find a free port, release it, then expect listenWithFallback to take it.
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	port := tcpPort(probe)
	probe.Close()

	ln, err := listenWithFallback("127.0.0.1", port, true)
	if err != nil {
		t.Fatalf("listenWithFallback: %v", err)
	}
	defer ln.Close()

	if got := tcpPort(ln); got != port {
		t.Fatalf("expected free port %d, got %d", port, got)
	}
}
