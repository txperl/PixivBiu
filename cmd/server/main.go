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
	"syscall"

	"github.com/go-chi/httplog/v3"

	"github.com/txperl/PixivBiu/internal/api"
	"github.com/txperl/PixivBiu/internal/auth"
	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/download"
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

	logger, err := newLogger(cfg.Log)
	if err != nil {
		return fmt.Errorf("init logger: %w", err)
	}
	slog.SetDefault(logger)

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

	pkceStore := auth.NewStore()
	handler := api.NewHandler(svc, hub, dlMgr, pkceStore, cfg.Inbox.Heartbeat, cfgMgr)
	httpHandler := server.New(cfg, logger, handler)

	addr := net.JoinHostPort(cfg.Server.Host, strconv.Itoa(cfg.Server.Port))
	srv := &http.Server{
		Addr:         addr,
		Handler:      httpHandler,
		ReadTimeout:  cfg.Server.Timeouts.Read,
		WriteTimeout: cfg.Server.Timeouts.Write,
	}

	printBanner(cfg, svc, addr, cfgMgr.StorePath())

	errCh := make(chan error, 1)
	go func() {
		logger.Info("server starting", slog.String("server.address", addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("listen: %w", err)
		}
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Server.Timeouts.Shutdown)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	logger.Info("server stopped")
	return nil
}

// printBanner writes a human-friendly boot summary to stderr: key URLs,
// auth state, and the most-asked-about config fields. slog keeps writing to
// stdout, so the banner stays out of the log stream.
func printBanner(cfg *config.Config, svc *pixiv.Service, addr, settingsPath string) {
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
 Listening    %s

   API      %s/api/v1
   Docs     %s/docs
   Spec     %s/openapi.json
   Health   %s/api/v1/health

   Auth     %s
   State    %s
   Settings %s
   Proxy    %s

   @Lang:%s @SNI-bypass:%s

 Go!
───────────────────────────────────────────────────────────────
`
	fmt.Fprintf(os.Stderr, strings.TrimSpace(banner)+"\n",
		version, runtime.Version(), runtime.GOOS, runtime.GOARCH,
		addr,
		base, base, base, base,
		auth, cfg.Pixiv.StateFile, settingsPath, proxy, cfg.Pixiv.Language, sni,
	)
}

func newLogger(cfg config.LogConfig) (*slog.Logger, error) {
	var level slog.Level
	if err := level.UnmarshalText([]byte(strings.ToUpper(cfg.Level))); err != nil {
		return nil, fmt.Errorf("invalid log level %q: %w", cfg.Level, err)
	}

	opts := &slog.HandlerOptions{
		Level:       level,
		ReplaceAttr: httplog.SchemaECS.ReplaceAttr,
	}
	var handler slog.Handler
	switch strings.ToLower(cfg.Format) {
	case "json":
		handler = slog.NewJSONHandler(os.Stdout, opts)
	case "", "text":
		handler = slog.NewTextHandler(os.Stdout, opts)
	default:
		return nil, fmt.Errorf("invalid log format %q (want text|json)", cfg.Format)
	}
	return slog.New(handler), nil
}
