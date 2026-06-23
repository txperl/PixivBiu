package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"strings"

	"github.com/txperl/PixivBiu/internal/browser"
	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/pixiv"
)

// serve binds the listener, prints the boot banner, optionally opens a
// browser, then runs the HTTP server until a serve error, shutdown signal, or
// restart request arrives. It performs the graceful drain (hub + server
// shutdown) and returns whether a restart was requested.
//
// The returned error's meaning depends on restarting: when restarting is true
// it is the raw srv.Shutdown error (run decides whether to force-close before
// re-exec); when false it is the final, already-wrapped error to return from
// run (a "listen:"/"shutdown:" failure, or nil). The svc/dlMgr lifecycle and
// the re-exec stay in run so their defers unwind in the right frame — serve
// never touches them.
func (a *app) serve(ctx context.Context) (bool, error) {
	// Bind explicitly (rather than ListenAndServe) so a busy port surfaces
	// synchronously, before we print "Ready!" or open a browser. With
	// server.port_fallback on (the default for the self-contained binary) we
	// walk to the next free port and report the *actual* address below; the
	// dev backend (make dev) turns it off so a busy port fails loud and the
	// fixed Vite proxy / gen:api stay correct. Once Listen returns the socket
	// is bound and connections queue in the backlog, so opening the browser
	// now can't hit connection-refused even before Serve starts accepting.
	ln, err := listenWithFallback(a.cfg.Server.Host, a.cfg.Server.Port, a.cfg.Server.PortFallback)
	if err != nil {
		return false, fmt.Errorf("listen: %w", err)
	}
	if actual := tcpPort(ln); actual != a.cfg.Server.Port {
		a.logger.Warn("configured port busy; using fallback",
			slog.Int("configured", a.cfg.Server.Port), slog.Int("actual", actual))
	}

	printBanner(a.cfg, a.svc, ln, a.cfgMgr.StorePath(), a.stateFile, a.storeFile)

	if a.openBrowser {
		// Best-effort: a failed launch must never block or fail boot. Open
		// returns once the launcher starts (and is a no-op on headless Linux).
		// Use the listener's actual port, not cfg: a fallback may have bumped
		// it, and the browser must land where the server really listens.
		if err := browser.Open(displayBaseURL(a.cfg, tcpPort(ln))); err != nil {
			a.logger.Warn("could not open browser", slog.Any("error", err))
		}
	}

	errCh := make(chan error, 1)
	go func() {
		a.logger.Info("server starting", slog.String("server.address", ln.Addr().String()))
		if err := a.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	var restarting bool
	select {
	case err := <-errCh:
		if err != nil {
			return false, fmt.Errorf("listen: %w", err)
		}
	case <-ctx.Done():
		a.logger.Info("shutdown signal received")
	case <-a.restartCh:
		restarting = true
		a.logger.Info("restart requested; draining for re-exec")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), a.cfg.Server.Timeouts.Shutdown)
	defer cancel()
	// Close SSE streams so they don't block the drain; other in-flight
	// requests finish normally within the deadline.
	a.hub.Shutdown()
	shutdownErr := a.srv.Shutdown(shutdownCtx)

	if restarting {
		return true, shutdownErr
	}
	if shutdownErr != nil {
		return false, fmt.Errorf("shutdown: %w", shutdownErr)
	}
	return false, nil
}

// maxPortFallback caps how many consecutive ports listenWithFallback tries
// when the configured one is busy: configured .. configured+maxPortFallback-1.
const maxPortFallback = 10

// listenWithFallback binds host:port. When fallback is true it walks forward
// to the next free port (up to maxPortFallback) when the configured one is in
// use — a common desktop case (a previous instance, or another app squatting
// the port). When false a busy port fails immediately, which is what the dev
// backend wants (its Vite proxy / gen:api are pinned to the configured port).
// Only a "port unavailable" error triggers a walk (see isPortUnavailable, which
// is platform-specific because Windows also reports WSAEACCES for reserved
// ports); a bad host or other failure fails right away so a real
// misconfiguration isn't silently masked.
func listenWithFallback(host string, port int, fallback bool) (net.Listener, error) {
	// The config's min/max only gates PATCH, not the startup file/env layers,
	// so a hand-set settings.json / PIXIVBIU_SERVER_PORT can arrive out of
	// range. Reject it here: otherwise the loop below would skip every attempt
	// and return a nil listener with no error, panicking the caller.
	if port < 1 || port > 65535 {
		return nil, fmt.Errorf("invalid server port %d (must be 1-65535)", port)
	}
	attempts := 1
	if fallback {
		attempts = maxPortFallback
	}
	var lastErr error
	for i := 0; i < attempts; i++ {
		p := port + i
		if p > 65535 {
			break
		}
		ln, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(p)))
		if err == nil {
			return ln, nil
		}
		if !isPortUnavailable(err) {
			return nil, err
		}
		lastErr = err
	}
	return nil, lastErr
}

// tcpPort returns the bound port of a TCP listener — the one spot that
// asserts net.Listen("tcp", …) yields a *net.TCPAddr.
func tcpPort(ln net.Listener) int { return ln.Addr().(*net.TCPAddr).Port }

// displayBaseURL builds the browseable root URL for the given bound port,
// rewriting wildcard/empty listen hosts to localhost so the value works in
// a browser (a browser can't navigate to http://0.0.0.0). net.JoinHostPort
// brackets IPv6 literals so ::1 becomes http://[::1]:port. Shared by the
// boot banner and the auto-open-browser launcher; callers pass the listener's
// actual port (tcpPort) so a port fallback is reflected everywhere.
func displayBaseURL(cfg *config.Config, port int) string {
	displayHost := cfg.Server.Host
	switch displayHost {
	case "0.0.0.0", "::", "":
		displayHost = "localhost"
	}
	return "http://" + net.JoinHostPort(displayHost, strconv.Itoa(port))
}

// printBanner writes a human-friendly boot summary to stderr: key URLs,
// auth state, and the most-asked-about config fields. slog keeps writing to
// stdout, so the banner stays out of the log stream. All banner text is
// fixed English; the frontend owns the UI locale (it reads `app.language`
// from GET /config and resolves `auto` against navigator.language).
func printBanner(cfg *config.Config, svc *pixiv.Service, ln net.Listener, settingsPath, statePath, indexPath string) {
	// Read the bound port off the listener, not cfg: a busy configured port
	// may have been bumped to a fallback, and the banner must point at where
	// the server actually listens.
	addr := ln.Addr().String()
	base := displayBaseURL(cfg, tcpPort(ln))

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
