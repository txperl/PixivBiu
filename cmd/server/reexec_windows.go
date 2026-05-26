//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

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
