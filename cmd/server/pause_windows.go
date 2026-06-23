//go:build windows

package main

import (
	"bufio"
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

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
