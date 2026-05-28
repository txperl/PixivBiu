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
	"github.com/txperl/PixivBiu/internal/i18n"
	"github.com/txperl/PixivBiu/internal/inbox"
	"github.com/txperl/PixivBiu/internal/pixiv"
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

	cfgMgr, err := config.NewManager(*configPath,
		// Templates only parse cleanly with the download funcmap, and a
		// bad proxy URL would only surface inside pixiv.NewService. Both
		// would fail the next boot if a PATCH let them through unchecked.
		config.WithValidator(func(c *config.Config) error {
			_, err := download.NewRenderer(c.Download, download.ExecRoot())
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

	// tr localises the boot banner and lifecycle log messages only;
	// structured slog fields and access logs stay English. The locale is
	// fixed at startup (log.language is not a reloadable concern).
	tr := i18n.New(i18n.Resolve(cfg.Log.Language))

	store := state.NewStore(cfg.Pixiv.StateFile)
	svc, err := pixiv.NewService(cfg.Pixiv, logger, store)
	if err != nil {
		return fmt.Errorf("init pixiv service: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	svc.Start(ctx)
	defer svc.Shutdown()

	hub := inbox.NewHub(cfg.Inbox.BufferSize)

	dlStore := download.NewStore(cfg.Download.StoreFile)
	dlPub := download.NewPublisher(hub, cfg.Inbox.ProgressThrottle)
	dlMgr, err := download.NewManager(cfg.Download, cfg.Pixiv.Proxy, logger, svc, dlStore, dlPub)
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

	printBanner(cfg, svc, tr, addr, cfgMgr.StorePath())

	errCh := make(chan error, 1)
	go func() {
		logger.Info(tr.T("lifecycle.starting"), slog.String("server.address", addr))
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
		logger.Info(tr.T("lifecycle.shutdown_signal"))
	case <-restartCh:
		restarting = true
		logger.Info(tr.T("lifecycle.restart_draining"))
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
			logger.Warn(tr.T("lifecycle.drain_timeout"),
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
		logger.Info(tr.T("lifecycle.reexec"))
		return reexec()
	}

	if shutdownErr != nil {
		return fmt.Errorf("shutdown: %w", shutdownErr)
	}
	logger.Info(tr.T("lifecycle.stopped"))
	return nil
}

// printBanner writes a human-friendly boot summary to stderr: key URLs,
// auth state, and the most-asked-about config fields. slog keeps writing to
// stdout, so the banner stays out of the log stream. The descriptive prose
// (tagline, "Listening" label, ready line) is localised via tr; the technical
// field labels (API/Docs/…) and literal addresses are left as-is.
func printBanner(cfg *config.Config, svc *pixiv.Service, tr *i18n.Translator, addr, settingsPath string) {
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
   Settings %s
   Proxy    %s

   @SNI-bypass:%s

 %s
───────────────────────────────────────────────────────────────
`
	fmt.Fprintf(os.Stderr, strings.TrimSpace(banner)+"\n",
		version, runtime.Version(), runtime.GOOS, runtime.GOARCH,
		tr.T("banner.tagline"),
		tr.T("banner.listening"), addr,
		base, base, base, base,
		auth, cfg.Pixiv.StateFile, settingsPath, proxy, sni,
		tr.T("banner.ready"),
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
