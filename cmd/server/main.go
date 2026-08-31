package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/txperl/PixivBiu/internal/runtimepath"
)

// version is the semantic version of the binary. Overridable at link time:
//
//	go build -ldflags "-X main.version=1.2.3"
var version = "0.1.0-dev"

// repoOwner/repoName identify the GitHub repository the self-updater checks for
// releases. A fork that self-publishes points these at its own repository.
const (
	repoOwner = "txperl"
	repoName  = "PixivBiu"
)

// updateTrustedKeysRaw holds the minisign (Ed25519) public keys the updater
// accepts as signers of the release's checksums.txt, stamped at link time. It is
// a plain string because -X can only set strings; multiple keys are comma- (or
// whitespace-) separated to allow forward-only rotation — ship the next public
// key before switching the signing key:
//
//	go build -ldflags "-X main.updateTrustedKeysRaw=RWQ…,RWZ…"
//
// Any stamped value makes the build signature-enforcing: releases without a
// valid checksums.txt.minisig are refused (a malformed stamped key still fails
// closed). Left empty (fork/dev builds), the updater degrades gracefully to
// HTTPS + SHA-256 verification alone — it does NOT fail closed, so a fork works
// without provisioning keys. The matching secret key lives only in CI (the
// MINISIGN_SECRET_KEY secret) and signs checksums.txt at release time (see
// internal/update).
var updateTrustedKeysRaw string

// updateTrustedKeys is the parsed trusted-key set. -X sets updateTrustedKeysRaw at
// link time, before package initializers run, so this sees the stamped value.
var updateTrustedKeys = parseTrustedKeys(updateTrustedKeysRaw)

// parseTrustedKeys splits a stamped key string into individual minisign public
// keys, tolerating comma, whitespace, or newline separators and dropping empties.
// Validation (and silent drop of malformed entries) happens downstream in
// update.parsePublicKeys; here we only tokenize. strings.Fields already splits on
// whitespace runs and drops empties, so mapping commas to spaces first covers both.
func parseTrustedKeys(raw string) []string {
	return strings.Fields(strings.ReplaceAll(raw, ",", " "))
}

func main() {
	suppressSIGPIPE()
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		// On Windows a double-clicked console window closes the instant we
		// exit, so without this the error above just flashes past. No-op when
		// run from a terminal/CI or on other OSes.
		pauseOnExit()
		os.Exit(1)
	}
}

// suppressSIGPIPE stops a broken or closed stdout/stderr from terminating the
// process. Per the os/signal contract, once SIGPIPE is delivered to a Notify
// channel the runtime no longer applies its default "exit on a write to fd 1/2"
// behavior — the write merely fails with EPIPE. That matters when log.file has
// taken over logging but the inherited stdio (e.g. a desktop GUI parent whose
// pipe has gone away) is dead: the boot banner and any os.Stderr prints must
// not kill the server. We never act on the notifications, so a small buffered
// channel we never drain is enough — suppression persists regardless, and extra
// signals are simply dropped. (SIGPIPE never fires on Windows; the call is a
// harmless no-op there.)
func suppressSIGPIPE() {
	signal.Notify(make(chan os.Signal, 1), syscall.SIGPIPE)
}

func run() error {
	configPath := flag.String("config", "./usr/settings.json", "path to runtime settings file (managed via API)")
	openFlag := flag.Bool("open", false, "open the web UI in the default browser at startup (overrides app.open_browser)")
	dataDir := flag.String("data-dir", "", "base directory for runtime files (settings, auth state, default downloads, and the image cache unless -cache-dir is set); defaults to the executable's directory. Also settable via PIXIVBIU_DATA_DIR; desktop builds point this at the OS user-data dir.")
	cacheDir := flag.String("cache-dir", "", "base directory for purgeable caches (image cache); defaults to usr/cache under the data root. Also settable via PIXIVBIU_CACHE_DIR; desktop builds point this at the OS cache dir so a large regenerable cache stays out of the app-data dir.")
	flag.Parse()

	// Anchor for every runtime path below — the config/state/index files,
	// the image cache, and a relative download.output_dir all derive from
	// this one root, so a single override relocates the whole tree. With no
	// override it's the executable's dir (portable single-binary layout;
	// under `make dev` it falls back to the repo root). See DataRoot for the
	// -data-dir / PIXIVBIU_DATA_DIR precedence and the desktop use case.
	root := runtimepath.DataRoot(*dataDir)

	// The image cache is a relocatable sibling of the data root: by default it
	// lives at usr/cache under root (consolidated layout), but -cache-dir /
	// PIXIVBIU_CACHE_DIR carve it out so the desktop shell can park a large,
	// regenerable cache in the OS cache dir instead of the backed-up app-data dir.
	cacheRoot := runtimepath.CacheRoot(*cacheDir, root)

	// The -config DEFAULT is anchored to the binary dir; a value the user
	// passed explicitly keeps normal shell/CWD semantics.
	settingsPath := *configPath
	if !flagPassed("config") {
		settingsPath = runtimepath.Anchor(root, settingsPath)
	}

	a, err := newApp(root, cacheRoot, settingsPath, openFlag, flagPassed("open"))
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
