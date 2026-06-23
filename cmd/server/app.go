package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"

	"github.com/txperl/PixivBiu/internal/api"
	"github.com/txperl/PixivBiu/internal/auth"
	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/download"
	"github.com/txperl/PixivBiu/internal/imgcache"
	"github.com/txperl/PixivBiu/internal/inbox"
	"github.com/txperl/PixivBiu/internal/pixiv"
	"github.com/txperl/PixivBiu/internal/runtimepath"
	"github.com/txperl/PixivBiu/internal/server"
	"github.com/txperl/PixivBiu/internal/state"
	"github.com/txperl/PixivBiu/internal/update"
)

// app holds the fully-wired-but-not-yet-started server: its services, the
// hot-reload atomics, the restart machinery, and the HTTP server. newApp
// constructs it; run owns the lifecycle (Start/defer Shutdown/restart) so the
// shutdown defers unwind in the frame that calls reexec. Always used via
// *app — it carries a sync.Once and an http.Server, which must not be copied.
type app struct {
	cfg    *config.Config
	cfgMgr *config.Manager

	logger   *slog.Logger
	levelVar *slog.LevelVar

	svc      *pixiv.Service
	hub      *inbox.Hub
	dlPub    *download.Publisher
	dlMgr    *download.Manager
	updSvc   *update.Service
	imgProxy *imgcache.Proxy

	// hbAtomic lets the reload hook adjust the SSE heartbeat live; the
	// handler reads it per connection.
	hbAtomic *atomic.Int64
	// searchPagesAtomic / searchConcurrencyAtomic let the reload hook adjust
	// search.sample.pages and .concurrency live; the handler reads them per
	// bookmarks_desc/views_desc search.
	searchPagesAtomic       *atomic.Int64
	searchConcurrencyAtomic *atomic.Int64

	// restartCh is closed (once, guarded by restartOnce) to request a
	// graceful self-restart; serve selects on it. See triggerRestart.
	restartCh   chan struct{}
	restartOnce sync.Once

	srv *http.Server

	// Resolved boot paths, surfaced in the banner.
	stateFile string
	storeFile string

	openBrowser bool
}

// newApp wires every service and the HTTP server from the loaded config. It
// only constructs — it never calls Start nor defers a Shutdown, so run keeps
// ownership of the lifecycle (see app). root anchors every runtime path;
// settingsPath is the (already anchored) config file; openFlag/openFlagSet
// carry the -open flag so the config value can be overridden only when it was
// explicitly passed.
func newApp(root, settingsPath string, openFlag *bool, openFlagSet bool) (*app, error) {
	a := &app{}

	// Seed the default update channel from the running build's maturity so a
	// pre-release build defaults to its own channel (a beta build keeps getting
	// betas) instead of the stable floor. Must precede NewManager, which reads
	// the defaults while building the schema; an explicit user override wins.
	config.SetDefaultUpdateChannel(update.DefaultChannel(version))

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
		return nil, fmt.Errorf("load config: %w", err)
	}
	a.cfgMgr = cfgMgr
	a.cfg = cfgMgr.Config()

	// Effective auto-open: the config/env value, overridden only when the
	// -open flag is explicitly passed (-open or -open=false). openFlagSet
	// reports only flags set on the command line, so an absent flag leaves
	// the config value intact.
	a.openBrowser = a.cfg.App.OpenBrowser
	if openFlagSet {
		a.openBrowser = *openFlag
	}

	logger, levelVar, err := newLogger(a.cfg.Log)
	if err != nil {
		return nil, fmt.Errorf("init logger: %w", err)
	}
	slog.SetDefault(logger)
	a.logger = logger
	a.levelVar = levelVar

	// Program-managed state/index files anchor to the binary dir too;
	// Anchor leaves absolute overrides untouched.
	a.stateFile = runtimepath.Anchor(root, a.cfg.Pixiv.StateFile)
	store := state.NewStore(a.stateFile)
	svc, err := pixiv.NewService(a.cfg.Pixiv, logger, store)
	if err != nil {
		return nil, fmt.Errorf("init pixiv service: %w", err)
	}
	a.svc = svc

	a.hub = inbox.NewHub(a.cfg.Inbox.BufferSize)

	a.storeFile = runtimepath.Anchor(root, a.cfg.Download.StoreFile)
	dlStore := download.NewStore(a.storeFile)
	a.dlPub = download.NewPublisher(a.hub, a.cfg.Inbox.ProgressThrottle)
	dlMgr, err := download.NewManager(a.cfg.Download, a.cfg.Pixiv.Proxy, logger, svc, dlStore, a.dlPub, root)
	if err != nil {
		return nil, fmt.Errorf("init download manager: %w", err)
	}
	a.dlMgr = dlMgr

	a.hbAtomic = new(atomic.Int64)
	a.hbAtomic.Store(int64(a.cfg.Inbox.Heartbeat))

	a.searchPagesAtomic = new(atomic.Int64)
	a.searchPagesAtomic.Store(int64(a.cfg.Search.Sample.Pages))
	a.searchConcurrencyAtomic = new(atomic.Int64)
	a.searchConcurrencyAtomic.Store(int64(a.cfg.Search.Sample.Concurrency))

	a.restartCh = make(chan struct{})

	// updSvc checks GitHub for newer releases and backs the one-click
	// self-update. It reuses pixiv.proxy so update traffic takes the same path
	// users already configured for Pixiv (e.g. behind the GFW). Start launches
	// the periodic background check, honoring app.update.enabled / interval live.
	a.updSvc = update.NewService(version, repoOwner, repoName, a.cfg.App.Update, a.cfg.Pixiv.Proxy)

	// imgProxy backs GET /proxy/img: it fetches i.pximg.net images with the
	// Pixiv Referer and disk-caches them under usr/cache/img (anchored to the
	// binary dir like the other usr/ files). It reuses pixiv.proxy and the
	// download HTTP timeout so image traffic follows the same path/limits.
	imgProxy, err := imgcache.NewProxy(
		runtimepath.Anchor(root, "usr/cache/img"),
		a.cfg.Image.Cache.MaxBytes(),
		a.cfg.Download.Referer,
		a.cfg.Pixiv.Proxy,
		a.cfg.Download.HTTPTimeout,
	)
	if err != nil {
		return nil, fmt.Errorf("init image proxy: %w", err)
	}
	a.imgProxy = imgProxy

	pkce := auth.NewStore()
	handler := api.NewHandler(a.svc, a.hub, a.dlMgr, pkce, a.hbAtomic, a.searchPagesAtomic, a.searchConcurrencyAtomic, a.cfgMgr, a.triggerRestart, a.updSvc, a.imgProxy, version)

	httpHandler := server.New(a.cfg, logger, handler)
	a.srv = &http.Server{
		Handler:      httpHandler,
		ReadTimeout:  a.cfg.Server.Timeouts.Read,
		WriteTimeout: a.cfg.Server.Timeouts.Write,
	}

	return a, nil
}

// triggerRestart requests a graceful self-restart. Closing restartCh is
// guarded by restartOnce so repeated POST /config/restart calls are safe.
// Passed to the handler at wiring time; serve selects on restartCh.
func (a *app) triggerRestart() {
	a.restartOnce.Do(func() { close(a.restartCh) })
}
