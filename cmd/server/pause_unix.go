//go:build !windows

package main

// pauseOnExit is a no-op off Windows: terminals there persist after the process
// exits, so a fatal message stays on screen on its own.
func pauseOnExit() {}
