//go:build windows

package main

// Windows platform shims: the port-busy classification, the fatal-exit
// pause, and the self-restart. Each differs from the Unix version (see
// platform_unix.go) — Windows has extra reserved-port errors, tears down
// double-click console windows on exit, and has no syscall.Exec.

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"unsafe"
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

var procGetConsoleProcessList = syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleProcessList")

// pauseOnExit keeps a double-clicked console window open long enough to read a
// fatal error. Launched from Explorer, Windows allocates a console solely for
// this process and tears the window down the instant it exits — so the stderr
// "fatal:" line just flashes past. GetConsoleProcessList returns the count of
// processes attached to our console; it's 1 only when we're the sole owner (the
// double-click case). Run from an existing cmd/PowerShell/CI it's >1 (or the call
// fails with no console), so those paths never block.
func pauseOnExit() {
	// A 2-slot buffer is deliberate: the second arg is the buffer capacity
	// GetConsoleProcessList may write, so capacity >= 2 is what lets the count
	// distinguish "exactly 1" (sole owner) from ">= 2". Don't shrink it to 1.
	var pids [2]uint32
	r, _, _ := procGetConsoleProcessList.Call(uintptr(unsafe.Pointer(&pids[0])), uintptr(len(pids)))
	if r != 1 {
		return
	}
	fmt.Fprint(os.Stderr, "\nPress Enter to exit...")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}

// reexec spawns a fresh copy of the binary (inheriting stdio and the
// environment) and exits, because Windows has no syscall.Exec. Unlike
// the unix path this changes the PID. On success it does not return; it
// only returns when the child fails to start.
func reexec() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn replacement process: %w", err)
	}
	os.Exit(0)
	return nil // unreachable
}
