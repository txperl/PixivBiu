package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/txperl/PixivBiu/internal/runtimepath"
)

// version is the semantic version of the binary. Overridable at link time:
//
//	go build -ldflags "-X main.version=1.2.3"
var version = "0.1.0-dev"

// repoOwner/repoName identify the GitHub repo the updater checks for releases.
const (
	repoOwner = "txperl"
	repoName  = "PixivBiu"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		// On Windows a double-clicked console window closes the instant we
		// exit, so without this the error above just flashes past. No-op when
		// run from a terminal/CI or on other OSes.
		pauseOnExit()
		os.Exit(1)
	}
}

func run() error {
	configPath := flag.String("config", "./usr/settings.json", "path to runtime settings file (managed via API)")
	openFlag := flag.Bool("open", false, "open the web UI in the default browser at startup (overrides app.open_browser)")
	dataDir := flag.String("data-dir", "", "base directory for runtime files (settings, auth state, image cache, default downloads); defaults to the executable's directory. Also settable via PIXIVBIU_DATA_DIR; desktop builds point this at the OS user-data dir.")
	flag.Parse()

	// Anchor for every runtime path below — the config/state/index files,
	// the image cache, and a relative download.output_dir all derive from
	// this one root, so a single override relocates the whole tree. With no
	// override it's the executable's dir (portable single-binary layout;
	// under `make dev` it falls back to the repo root). See DataRoot for the
	// -data-dir / PIXIVBIU_DATA_DIR precedence and the desktop use case.
	root := runtimepath.DataRoot(*dataDir)

	// The -config DEFAULT is anchored to the binary dir; a value the user
	// passed explicitly keeps normal shell/CWD semantics.
	settingsPath := *configPath
	if !flagPassed("config") {
		settingsPath = runtimepath.Anchor(root, settingsPath)
	}

	a, err := newApp(root, settingsPath, openFlag, flagPassed("open"))
	if err != nil {
		return err
	}

	// ctx + signal handling and the load-bearing defers stay HERE: on a
	// restart the explicit Shutdowns + reexec below bypass these defers
	// (syscall.Exec replaces the image), which only works if they live in
	// the same frame as the reexec call.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	a.svc.Start(ctx)
	defer a.svc.Shutdown()

	a.dlMgr.Start(ctx)
	defer a.dlMgr.Shutdown()

	a.updSvc.Start(ctx, a.logger)
	a.imgProxy.Start(ctx)

	a.registerReloadHooks()

	restarting, shutdownErr := a.serve(ctx)

	if restarting {
		// A restart is the user's explicit intent (we already answered
		// 202), so re-exec even if the graceful drain timed out — a slow
		// non-SSE request must not strand us here. Force-close whatever
		// the drain didn't finish before replacing the process image.
		if shutdownErr != nil {
			a.logger.Warn("graceful drain timed out before restart; forcing close",
				slog.Any("error", shutdownErr))
			_ = a.srv.Close()
		}
		// syscall.Exec replaces the image, so the deferred Shutdowns
		// above would never run — flush their state explicitly here
		// (dlMgr persists the job index; svc stops the refresh loop).
		// In-flight downloads are reset to queued and re-enqueued on the
		// next boot (Manager.Start), so the restart is non-destructive.
		// stop() (signal cleanup) is intentionally omitted: exec resets
		// signal dispositions, and the deferred stop() covers a failed reexec.
		a.dlMgr.Shutdown()
		a.svc.Shutdown()
		a.logger.Info("re-executing to apply restart-required settings")
		return reexec()
	}

	if shutdownErr != nil {
		return shutdownErr
	}
	a.logger.Info("server stopped")
	return nil
}

// flagPassed reports whether the named flag was set explicitly on the
// command line. An explicit -config keeps normal shell/CWD semantics,
// while the default value is anchored to the binary dir.
func flagPassed(name string) bool {
	var found bool
	flag.Visit(func(f *flag.Flag) {
		if f.Name == name {
			found = true
		}
	})
	return found
}
