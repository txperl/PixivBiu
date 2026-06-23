package main

import (
	"log/slog"

	"github.com/txperl/PixivBiu/internal/config"
)

// registerReloadHooks wires the config-manager reload callbacks that apply
// live (non-restart) settings on PATCH. It must run after newApp so every
// service the hooks close over exists.
//
// Reload hooks each take the whole *Config because some keys cross
// service boundaries — pixiv.proxy is reused by the download client.
// Restart-required keys are pinned inside each Reload, so passing the
// full new config is safe.
func (a *app) registerReloadHooks() {
	a.cfgMgr.OnReload(func(n *config.Config) {
		if lvl, err := parseLogLevel(n.Log.Level); err == nil {
			a.levelVar.Set(lvl)
		}
	})
	a.cfgMgr.OnReload(func(n *config.Config) {
		if err := a.svc.Reload(n.Pixiv); err != nil {
			a.logger.Error("pixiv config reload failed", slog.Any("error", err))
		}
	})
	a.cfgMgr.OnReload(func(n *config.Config) {
		if err := a.dlMgr.Reload(n.Download, n.Pixiv.Proxy); err != nil {
			a.logger.Error("download config reload failed", slog.Any("error", err))
		}
	})
	a.cfgMgr.OnReload(func(n *config.Config) {
		a.dlPub.SetThrottle(n.Inbox.ProgressThrottle)
	})
	a.cfgMgr.OnReload(func(n *config.Config) {
		a.hbAtomic.Store(int64(n.Inbox.Heartbeat))
	})
	a.cfgMgr.OnReload(func(n *config.Config) {
		a.searchPagesAtomic.Store(int64(n.Search.Sample.Pages))
		a.searchConcurrencyAtomic.Store(int64(n.Search.Sample.Concurrency))
	})
	a.cfgMgr.OnReload(func(n *config.Config) {
		a.updSvc.Reload(n.App.Update, n.Pixiv.Proxy)
	})
	a.cfgMgr.OnReload(func(n *config.Config) {
		if err := a.imgProxy.Reload(n.Image.Cache.MaxBytes(), n.Pixiv.Proxy, n.Download.HTTPTimeout); err != nil {
			a.logger.Error("image proxy reload failed", slog.Any("error", err))
		}
	})
}
