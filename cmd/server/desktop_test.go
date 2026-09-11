package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDesktopParentLease(t *testing.T) {
	for _, input := range []string{"", "stop\n", "unknown\nstop\n", strings.Repeat("x", 1024)} {
		ctx, cancel := context.WithCancel(context.Background())
		watchDesktopParent(strings.NewReader(input), cancel)
		if ctx.Err() == nil {
			t.Fatal("lease did not cancel on stop, EOF or invalid oversized input")
		}
	}
	reader, writer := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { watchDesktopParent(reader, cancel); close(done) }()
	if ctx.Err() != nil {
		t.Fatal("live parent lease canceled")
	}
	writer.CloseWithError(io.ErrUnexpectedEOF)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("broken parent pipe did not cancel")
	}
	reader.Close()
}

// Exercise the real entrypoint in an isolated subprocess; flags/globals and
// os.Exit must never affect the test runner. No real account data is loaded.
func TestDesktopManagedHelper(t *testing.T) {
	root := os.Getenv("PIXIVBIU_TEST_DESKTOP_ROOT")
	if root == "" {
		return
	}
	flag.CommandLine = flag.NewFlagSet("pixivbiu", flag.ExitOnError)
	os.Args = []string{"pixivbiu", "-desktop-managed=1", "-data-dir", root}
	main()
	os.Exit(0)
}

func TestDesktopManagedLifecycle(t *testing.T) {
	for _, action := range []string{"stop", "eof", "restart", "busy"} {
		t.Run(action, func(t *testing.T) {
			root := t.TempDir()
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			port := listener.Addr().(*net.TCPAddr).Port
			if action != "busy" {
				listener.Close()
			} else {
				defer listener.Close()
			}
			if err := os.MkdirAll(filepath.Join(root, "usr"), 0o700); err != nil {
				t.Fatal(err)
			}
			settings := map[string]any{
				"server": map[string]any{"host": "127.0.0.1", "port": port, "port_fallback": false},
				"app":    map[string]any{"open_browser": false, "update": map[string]any{"enabled": false}},
				"log":    map[string]any{"file": filepath.Join(root, "core.log")},
				// Prevent any accidental external request; tokens below are synthetic.
				"pixiv": map[string]any{"proxy": "http://127.0.0.1:1"},
			}
			data, _ := json.Marshal(settings)
			if err := os.WriteFile(filepath.Join(root, "usr", "settings.json"), data, 0o600); err != nil {
				t.Fatal(err)
			}
			data, _ = json.Marshal(map[string]any{"refresh_token": "fixture-refresh", "access_token": "fixture-access", "access_token_expires_at": time.Now().Add(24 * time.Hour), "user_id": 1})
			if err := os.WriteFile(filepath.Join(root, "usr", "state.json"), data, 0o600); err != nil {
				t.Fatal(err)
			}

			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDesktopManagedHelper$")
			for _, value := range os.Environ() {
				if !strings.HasPrefix(strings.ToUpper(value), "PIXIVBIU_") {
					cmd.Env = append(cmd.Env, value)
				}
			}
			cmd.Env = append(cmd.Env, "PIXIVBIU_TEST_DESKTOP_ROOT="+root)
			stdin, err := cmd.StdinPipe()
			if err != nil {
				t.Fatal(err)
			}
			stdout, err := cmd.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			var stderr bytes.Buffer
			cmd.Stderr = &stderr
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = cmd.Process.Kill() })
			line, err := bufio.NewReader(stdout).ReadString('\n')
			if err != nil || line != desktopProtocolMarker+"\n" {
				t.Fatalf("missing managed handshake: %q %v", line, err)
			}
			base := "http://127.0.0.1:" + strconv.Itoa(port)
			client := &http.Client{Timeout: time.Second}
			if action != "busy" {
				ready := false
				for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
					res, err := client.Get(base + "/api/v1/health")
					if err == nil {
						res.Body.Close()
						ready = res.StatusCode == 200
					}
					if ready {
						break
					}
					time.Sleep(25 * time.Millisecond)
				}
				if !ready {
					t.Fatal("core did not become healthy")
				}
			}
			want := 0
			switch action {
			case "stop":
				_, err = io.WriteString(stdin, "stop\n")
				if err != nil {
					t.Fatal(err)
				}
			case "eof":
				stdin.Close()
			case "restart":
				res, err := client.Post(base+"/api/v1/config/restart", "application/json", nil)
				if err != nil {
					t.Fatal(err)
				}
				res.Body.Close()
				if res.StatusCode != http.StatusAccepted {
					t.Fatalf("restart status %d", res.StatusCode)
				}
				want = desktopRestartExitCode
			case "busy":
				want = desktopPortBusyExitCode
			}
			err = cmd.Wait()
			if ctx.Err() != nil {
				t.Fatal("managed process did not exit within deadline")
			}
			if cmd.ProcessState.ExitCode() != want {
				t.Fatalf("exit=%d want=%d: %v; %s", cmd.ProcessState.ExitCode(), want, err, stderr.String())
			}
			stdin.Close()
			if action != "busy" {
				probe, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
				if err != nil {
					t.Fatalf("managed child left its port occupied: %v", err)
				}
				probe.Close()
			}
		})
	}
}
