package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"

	"github.com/go-chi/httplog/v3"

	"github.com/txperl/PixivBiu/internal/api"
	"github.com/txperl/PixivBiu/internal/auth"
	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/download"
	"github.com/txperl/PixivBiu/internal/inbox"
	"github.com/txperl/PixivBiu/internal/pixiv"
	"github.com/txperl/PixivBiu/internal/runtimepath"
	"github.com/txperl/PixivBiu/internal/server"
	"github.com/txperl/PixivBiu/internal/state"
)

// version is the semantic version of the binary. Overridable at link time:
//
//	go build -ldflags "-X main.version=1.2.3"
var version = "0.1.0-dev"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}

func run() error {
	configPath := flag.String("config", "./usr/settings.json", "path to runtime settings file (managed via API)")
	flag.Parse()

	// Relative runtime paths anchor to the executable's directory so the
	// same binary reads/writes the same files regardless of launch CWD
	// (matching download.output_dir). Under `make dev` (go run) Root()
	// falls back to the repo root. See internal/runtimepath.
	root := runtimepath.Root()

	// The -config DEFAULT is anchored to the binary dir; a value the user
	// passed explicitly keeps normal shell/CWD semantics.
	settingsPath := *configPath
	if !flagPassed("config") {
		settingsPath = runtimepath.Anchor(root, settingsPath)
	}

	cfgMgr, err := config.NewManager(settingsPath,
		// Templates only parse cleanly with the download funcmap, and a
		// bad proxy URL would only surface inside pixiv.NewService. Both
		// would fail the next boot if a PATCH let them through unchecked.
		config.WithValidator(func(c *config.Config) error {
			_, err := download.NewRenderer(c.Download, root)
			return err
		}),
		config.WithValidator(func(c *config.Config) error {
			if c.Pixiv.Proxy == "" {
				return nil
			}
			// url.Parse alone accepts bare "host:port" by treating the host
			// as the scheme — and http.ProxyURL then silently no-ops at
			// request time. Require a populated Host so a missing scheme is
			// rejected at PATCH instead of breaking proxying after restart.
			u, err := url.Parse(c.Pixiv.Proxy)
			if err != nil {
				return fmt.Errorf("pixiv.proxy: %w", err)
			}
			if u.Host == "" {
				return fmt.Errorf("pixiv.proxy: missing scheme://host (got %q)", c.Pixiv.Proxy)
			}
			return nil
		}),
	)
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	cfg := cfgMgr.Config()

	logger, levelVar, err := newLogger(cfg.Log)
	if err != nil {
		return fmt.Errorf("init logger: %w", err)
	}
	slog.SetDefault(logger)

	// Program-managed state/index files anchor to the binary dir too;
	// Anchor leaves absolute overrides untouched.
	stateFile := runtimepath.Anchor(root, cfg.Pixiv.StateFile)
	store := state.NewStore(stateFile)
	svc, err := pixiv.NewService(cfg.Pixiv, logger, store)
	if err != nil {
		return fmt.Errorf("init pixiv service: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	svc.Start(ctx)
	defer svc.Shutdown()

	hub := inbox.NewHub(cfg.Inbox.BufferSize)

	storeFile := runtimepath.Anchor(root, cfg.Download.StoreFile)
	dlStore := download.NewStore(storeFile)
	dlPub := download.NewPublisher(hub, cfg.Inbox.ProgressThrottle)
	dlMgr, err := download.NewManager(cfg.Download, cfg.Pixiv.Proxy, logger, svc, dlStore, dlPub, root)
	if err != nil {
		return fmt.Errorf("init download manager: %w", err)
	}
	dlMgr.Start(ctx)
	defer dlMgr.Shutdown()

	// hbAtomic lets the reload hook adjust the SSE heartbeat live; the
	// handler reads it per connection.
	hbAtomic := new(atomic.Int64)
	hbAtomic.Store(int64(cfg.Inbox.Heartbeat))

	// restart triggers a graceful self-restart. Closing the channel is
	// guarded by Once so repeated POST /config/restart calls are safe.
	restartCh := make(chan struct{})
	var restartOnce sync.Once
	restart := func() { restartOnce.Do(func() { close(restartCh) }) }

	pkceStore := auth.NewStore()
	handler := api.NewHandler(svc, hub, dlMgr, pkceStore, hbAtomic, cfgMgr, restart)

	// Reload hooks each take the whole *Config because some keys cross
	// service boundaries — pixiv.proxy is reused by the download client.
	// Restart-required keys are pinned inside each Reload, so passing the
	// full new config is safe.
	cfgMgr.OnReload(func(n *config.Config) {
		if lvl, err := parseLogLevel(n.Log.Level); err == nil {
			levelVar.Set(lvl)
		}
	})
	cfgMgr.OnReload(func(n *config.Config) {
		if err := svc.Reload(n.Pixiv); err != nil {
			logger.Error("pixiv config reload failed", slog.Any("error", err))
		}
	})
	cfgMgr.OnReload(func(n *config.Config) {
		if err := dlMgr.Reload(n.Download, n.Pixiv.Proxy); err != nil {
			logger.Error("download config reload failed", slog.Any("error", err))
		}
	})
	cfgMgr.OnReload(func(n *config.Config) {
		dlPub.SetThrottle(n.Inbox.ProgressThrottle)
	})
	cfgMgr.OnReload(func(n *config.Config) {
		hbAtomic.Store(int64(n.Inbox.Heartbeat))
	})

	httpHandler := server.New(cfg, logger, handler)

	addr := net.JoinHostPort(cfg.Server.Host, strconv.Itoa(cfg.Server.Port))
	srv := &http.Server{
		Addr:         addr,
		Handler:      httpHandler,
		ReadTimeout:  cfg.Server.Timeouts.Read,
		WriteTimeout: cfg.Server.Timeouts.Write,
	}

	printBanner(cfg, svc, addr, cfgMgr.StorePath(), stateFile, storeFile)

	errCh := make(chan error, 1)
	go func() {
		logger.Info("server starting", slog.String("server.address", addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	var restarting bool
	select {
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("listen: %w", err)
		}
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	case <-restartCh:
		restarting = true
		logger.Info("restart requested; draining for re-exec")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Server.Timeouts.Shutdown)
	defer cancel()
	// Close SSE streams so they don't block the drain; other in-flight
	// requests finish normally within the deadline.
	hub.Shutdown()
	shutdownErr := srv.Shutdown(shutdownCtx)

	if restarting {
		// A restart is the user's explicit intent (we already answered
		// 202), so re-exec even if the graceful drain timed out — a slow
		// non-SSE request must not strand us here. Force-close whatever
		// the drain didn't finish before replacing the process image.
		if shutdownErr != nil {
			logger.Warn("graceful drain timed out before restart; forcing close",
				slog.Any("error", shutdownErr))
			_ = srv.Close()
		}
		// syscall.Exec replaces the image, so the deferred Shutdowns
		// below would never run — flush their state explicitly here
		// (dlMgr persists the job index; svc stops the refresh loop).
		// In-flight downloads are reset to queued and re-enqueued on the
		// next boot (Manager.Start), so the restart is non-destructive.
		// stop() (signal cleanup) is intentionally omitted: exec resets
		// signal dispositions, and the deferred stop() covers a failed reexec.
		dlMgr.Shutdown()
		svc.Shutdown()
		logger.Info("re-executing to apply restart-required settings")
		return reexec()
	}

	if shutdownErr != nil {
		return fmt.Errorf("shutdown: %w", shutdownErr)
	}
	logger.Info("server stopped")
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

// printBanner writes a human-friendly boot summary to stderr: key URLs,
// auth state, and the most-asked-about config fields. slog keeps writing to
// stdout, so the banner stays out of the log stream. All banner text is
// fixed English; the frontend owns the UI locale (it reads `app.language`
// from GET /config and resolves `auto` against navigator.language).
func printBanner(cfg *config.Config, svc *pixiv.Service, addr, settingsPath, statePath, indexPath string) {
	displayHost := cfg.Server.Host
	switch displayHost {
	case "0.0.0.0", "::", "":
		displayHost = "localhost"
	}
	base := fmt.Sprintf("http://%s:%d", displayHost, cfg.Server.Port)

	proxy := cfg.Pixiv.Proxy
	if proxy == "" {
		proxy = "direct"
	}
	sni := "off"
	if cfg.Pixiv.BypassSNI {
		sni = "on"
	}

	auth := "anonymous  (POST /auth/login to authenticate)"
	if svc.Authenticated() {
		t := svc.Snapshot()
		name := t.UserName
		if name == "" {
			name = "(unnamed)"
		}
		auth = fmt.Sprintf("user_id=%d  name=%s  expires=%s",
			t.UserID, name, t.AccessTokenExpiresAt.Format("15:04:05 MST"))
	}

	const banner = `
───────────────────────────────────────────────────────────────
 PixivBiu     %s (%s %s/%s)
 %s

 %s  %s

   API      %s/api/v1
   Docs     %s/docs
   Spec     %s/openapi.json
   Health   %s/api/v1/health

   Auth     %s
   State    %s
   Index    %s
   Settings %s
   Proxy    %s

   @SNI-bypass:%s

 %s
───────────────────────────────────────────────────────────────
`
	fmt.Fprintf(os.Stderr, strings.TrimSpace(banner)+"\n",
		version, runtime.Version(), runtime.GOOS, runtime.GOARCH,
		"Pixiv companion server",
		"Listening", addr,
		base, base, base, base,
		auth, statePath, indexPath, settingsPath, proxy, sni,
		"Ready!",
	)
}

// parseLogLevel converts a config log level string into a slog.Level.
// Shared by newLogger and the log.level reload hook.
func parseLogLevel(s string) (slog.Level, error) {
	var level slog.Level
	if err := level.UnmarshalText([]byte(strings.ToUpper(s))); err != nil {
		return 0, fmt.Errorf("invalid log level %q: %w", s, err)
	}
	return level, nil
}

// newLogger builds the slog logger and returns the *slog.LevelVar that
// gates it, so the log.level reload hook can change the level live. The
// handler type is fixed by log.format (restart-required), so only the
// level is adjustable at runtime.
func newLogger(cfg config.LogConfig) (*slog.Logger, *slog.LevelVar, error) {
	level, err := parseLogLevel(cfg.Level)
	if err != nil {
		return nil, nil, err
	}
	levelVar := new(slog.LevelVar)
	levelVar.Set(level)

	opts := &slog.HandlerOptions{
		Level:       levelVar,
		ReplaceAttr: httplog.SchemaECS.ReplaceAttr,
	}
	var handler slog.Handler
	switch strings.ToLower(cfg.Format) {
	case "json":
		handler = slog.NewJSONHandler(os.Stdout, opts)
	case "", "text":
		handler = slog.NewTextHandler(os.Stdout, opts)
	default:
		return nil, nil, fmt.Errorf("invalid log format %q (want text|json)", cfg.Format)
	}
	return slog.New(handler), levelVar, nil
}
