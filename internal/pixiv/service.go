// Package pixiv wraps github.com/txperl/pixivgo with a thin auth/refresh
// layer and the handful of upstream calls the HTTP API needs.
package pixiv

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/txperl/pixivgo"
	"github.com/txperl/pixivgo/bypass"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/state"
)

// Service wraps a *pixivgo.Client plus the refresh goroutine and the token
// state file. All handlers go through this type.
type Service struct {
	cfg    config.PixivConfig
	logger *slog.Logger
	store  *state.Store
	client *pixivgo.Client
	// httpc is the raw HTTP client used for OAuth flows pixivgo doesn't
	// implement (authorization_code grant). It shares proxy/SNI-bypass
	// configuration with pixivgo so the OAuth call traverses the same path
	// as everything else.
	httpc *http.Client

	mu    sync.RWMutex
	token state.Token
	// sessionExpired is set when the session was cleared because Pixiv rejected
	// the refresh token (invalid_grant), so /auth/status can tell the login page
	// to show a "session expired" hint instead of the first-run welcome. Reset on
	// the next successful refresh/login. Guarded by mu.
	sessionExpired bool

	// refreshMu serializes auth publishes (Login, Logout, the loop, the on-401
	// refresh) so a stale refresh can't clobber a fresh login, and single-flights
	// a burst of 401s into one refresh. NOT held across a retry (that uses a
	// pinned client Clone), so retries still run in parallel. Order: refreshMu before mu.
	refreshMu sync.Mutex

	wg   sync.WaitGroup
	stop context.CancelFunc
}

// NewService builds the client and loads persisted state, but does not call
// the network. Use Start to perform the initial Auth and kick off the refresh
// loop. Shutdown cancels the loop and waits for it to exit.
func NewService(cfg config.PixivConfig, logger *slog.Logger, store *state.Store) (*Service, error) {
	client, httpc, err := buildClient(cfg)
	if err != nil {
		return nil, err
	}

	tok, err := store.Load()
	if err != nil {
		return nil, fmt.Errorf("load token state: %w", err)
	}

	s := &Service{
		cfg:    cfg,
		logger: logger,
		store:  store,
		client: client,
		httpc:  httpc,
		token:  tok,
	}

	if !tok.IsEmpty() {
		client.SetAuth(tok.AccessToken, tok.RefreshToken)
	}
	return s, nil
}

// Start performs an initial token refresh (only when the persisted access token
// is missing or near expiry) and launches the background refresh loop. A
// failure here is logged but not fatal — the refresh token is the session, so
// the user stays authenticated and authenticated calls self-heal (call.go).
func (s *Service) Start(ctx context.Context) {
	ctx, s.stop = context.WithCancel(ctx)

	tok := s.Snapshot()
	if tok.RefreshToken != "" && needsInitialRefresh(tok) {
		// Run the shared automatic-refresh handling (clear-on-reject for a revoked
		// token, retry log for a transient failure) under refreshMu, the same lock
		// the loop and on-401 paths use. The outcome is handled in
		// refreshSessionLocked; Start never aborts on it.
		s.refreshMu.Lock()
		_, _ = s.refreshSessionLocked(ctx, tok.RefreshToken)
		s.refreshMu.Unlock()
	}

	s.wg.Add(1)
	go s.loop(ctx)
}

// needsInitialRefresh reports whether Start should refresh the access token at
// boot. We skip the network round-trip when the persisted access token still
// has comfortable life left (mirrors the loop's lead time), so launching no
// longer rewrites the expiry of a still-valid token and boot isn't blocked on
// Pixiv when it needn't be. A missing/near-expiry access token still refreshes;
// a token revoked server-side is caught lazily by the on-401 self-heal. Correct
// across sleep/wake because AccessTokenExpiresAt is stored with the monotonic
// reading stripped (.Round(0)).
func needsInitialRefresh(tok state.Token) bool {
	if tok.AccessToken == "" || tok.AccessTokenExpiresAt.IsZero() {
		return true
	}
	return time.Until(tok.AccessTokenExpiresAt) <= refreshLeadTime
}

// Shutdown cancels the refresh loop and waits for it to exit.
func (s *Service) Shutdown() {
	if s.stop != nil {
		s.stop()
	}
	s.wg.Wait()
}

// Authenticated reports whether we hold a usable session — i.e. a refresh
// token. An expired access token is NOT logged out: the loop and the on-401
// self-heal (call.go) renew it transparently. Only a permanent refresh
// rejection (invalid_grant) clears the session.
func (s *Service) Authenticated() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.token.RefreshToken != ""
}

// SessionExpired reports whether the last session was cleared because Pixiv
// rejected the refresh token (invalid_grant), as opposed to never having logged
// in. It is reset on the next successful refresh/login. Only meaningful while
// unauthenticated.
func (s *Service) SessionExpired() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sessionExpired
}

// Snapshot returns a copy of the current persisted token state.
func (s *Service) Snapshot() state.Token {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.token
}

// AuthSnapshot returns the persisted token together with the session-expired
// flag, read under a single lock so the two stay consistent (both are mutated
// together under mu). Used by GetAuthStatus to project /auth/status.
func (s *Service) AuthSnapshot() (state.Token, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.token, s.sessionExpired
}

// Client returns the underlying pixivgo client. For authenticated API calls
// prefer the package-level Call / Exec wrappers — a bare Client() won't
// refresh-and-retry on a 401. Read under s.mu because Reload may swap s.client.
func (s *Service) Client() *pixivgo.Client {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.client
}

// Reload rebuilds the client/httpc when the hot-reloadable proxy setting
// changes, preserving the current auth token and the running refresh loop.
// bypass_sni and state_file are restart-only, so their values are pinned to
// the running config. On a build failure the existing client is left
// untouched and the error is returned.
func (s *Service) Reload(cfg config.PixivConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if cfg.Proxy == s.cfg.Proxy {
		return nil
	}
	cfg.BypassSNI = s.cfg.BypassSNI
	cfg.StateFile = s.cfg.StateFile

	client, httpc, err := buildClient(cfg)
	if err != nil {
		return fmt.Errorf("rebuild pixiv client: %w", err)
	}
	if s.token.AccessToken != "" || s.token.RefreshToken != "" {
		client.SetAuth(s.token.AccessToken, s.token.RefreshToken)
	}
	s.client, s.httpc, s.cfg = client, httpc, cfg
	return nil
}

// Login exchanges a refresh token for a fresh access token and persists it.
func (s *Service) Login(ctx context.Context, refreshToken string) (state.Token, error) {
	if refreshToken == "" {
		return state.Token{}, ErrNoRefreshToken
	}
	return s.refresh(ctx, refreshToken)
}

// LoginWithAuthCode completes the browser-driven Pixiv OAuth flow: it trades
// the authorization code (+ the PKCE verifier the server issued earlier) for
// a refresh token via Pixiv's token endpoint, then funnels the result through
// the same refresh path as Login so persistence / refresh-loop wiring is
// shared and there's no second code path for token state to drift on.
func (s *Service) LoginWithAuthCode(ctx context.Context, code, verifier string) (state.Token, error) {
	if code == "" {
		return state.Token{}, ErrNoAuthCode
	}
	if verifier == "" {
		return state.Token{}, ErrNoRefreshToken
	}
	// One budget for both upstream round-trips (code exchange + refresh). On
	// the failure path only the first call runs, so the two never stack to
	// 2×authTimeout, keeping the whole operation under the server WriteTimeout.
	ctx, cancel := context.WithTimeout(ctx, authTimeout)
	defer cancel()
	s.mu.RLock()
	httpc := s.httpc
	s.mu.RUnlock()
	rt, err := ExchangeAuthCode(ctx, httpc, code, verifier)
	if err != nil {
		return state.Token{}, err
	}
	return s.refresh(ctx, rt)
}

// Logout clears the in-memory and on-disk token state at the user's request.
func (s *Service) Logout() error {
	return s.clearSession(false)
}

// clearSession wipes in-memory + on-disk token state and the client's auth,
// under refreshMu so an in-flight refresh can't re-publish a stale token over
// the cleared state. expired=true records that the clear was forced by a
// rejected refresh token (invalid_grant) so /auth/status can surface a "session
// expired" hint; an explicit logout passes false.
func (s *Service) clearSession(expired bool) error {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()
	return s.clearSessionLocked(expired)
}

// clearSessionLocked is the body of clearSession for callers that already hold
// refreshMu (the loop's refreshCurrent path and the on-401 refreshForRetry).
// refreshMu is not reentrant, so those paths must use this variant.
func (s *Service) clearSessionLocked(expired bool) error {
	s.mu.Lock()
	s.token = state.Token{}
	s.sessionExpired = expired
	client := s.client
	s.mu.Unlock()
	client.SetAuth("", "")
	return s.store.Clear()
}

// refresh authenticates with an explicit refreshToken and publishes the result.
// Used by Start, Login, and LoginWithAuthCode.
func (s *Service) refresh(ctx context.Context, refreshToken string) (state.Token, error) {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()
	return s.refreshLocked(ctx, refreshToken)
}

// refreshCurrent refreshes the current session, re-reading the token under
// refreshMu so it can't refresh a stale session. Used by the loop; no-op when
// logged out.
func (s *Service) refreshCurrent(ctx context.Context) (state.Token, error) {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()
	rt := s.refreshToken()
	if rt == "" {
		return state.Token{}, nil // logged out since the loop's check — nothing to do
	}
	return s.refreshSessionLocked(ctx, rt)
}

// refreshSessionLocked re-authenticates the current session and centralises the
// failure handling shared by the *automatic* re-auth paths (boot, the refresh
// loop, and the on-401 retry): a permanent rejection (invalid_grant) clears the
// session and flags it expired so the next /auth/status shows a "session
// expired" hint; a transient failure (network/timeout/5xx) is logged and the
// session kept for a later retry. Caller MUST hold refreshMu.
//
// User-initiated Login / LoginWithAuthCode deliberately call refreshLocked
// directly, NOT this — a token the user just supplied being rejected must not
// wipe an already-good session.
func (s *Service) refreshSessionLocked(ctx context.Context, refreshToken string) (state.Token, error) {
	tok, err := s.refreshLocked(ctx, refreshToken)
	if err == nil {
		return tok, nil
	}
	if isInvalidGrant(err) {
		s.logger.Warn("pixiv refresh token rejected; clearing session", slog.Any("error", err))
		if cerr := s.clearSessionLocked(true); cerr != nil {
			s.logger.Error("clear session failed", slog.Any("error", cerr))
		}
	} else {
		s.logger.Warn("pixiv token refresh failed; keeping session, will retry", slog.Any("error", err))
	}
	return tok, err
}

// refreshLocked authenticates and publishes the new token (in-memory, on-disk,
// and the client itself). Caller MUST hold refreshMu.
func (s *Service) refreshLocked(ctx context.Context, refreshToken string) (state.Token, error) {
	// Bound every token refresh so an unreachable Pixiv fails within authTimeout
	// (kept under the server WriteTimeout) instead of hanging. Covers Start,
	// Login, and the background loop; under LoginWithAuthCode's wider span budget
	// this is a harmless no-op — the outer deadline is already the tighter one.
	ctx, cancel := context.WithTimeout(ctx, authTimeout)
	defer cancel()

	// Snapshot the client under the lock: Reload may swap it concurrently.
	s.mu.RLock()
	client := s.client
	s.mu.RUnlock()

	resp, err := client.Auth(ctx, refreshToken)
	if err != nil {
		return state.Token{}, err
	}

	// AccessTokenExpiresAt uses .Round(0) to strip the monotonic clock reading,
	// leaving a pure wall-clock instant. macOS pauses the monotonic clock during
	// system sleep; without this, time.Until() over-estimates the remaining
	// lifetime after a long sleep and loop skips a needed refresh while the token
	// is already wall-clock expired — every request then fails until a restart
	// reloads the (wall-clock) expiry from disk.
	tok := state.Token{
		RefreshToken:         resp.RefreshToken,
		AccessToken:          resp.AccessToken,
		AccessTokenExpiresAt: time.Now().Add(time.Duration(resp.ExpiresIn) * time.Second).Round(0),
		UserID:               int64(resp.User.ID.Int()),
		UserName:             resp.User.Name,
	}

	// Re-apply the fresh token to whatever client is current under the
	// same lock that Reload uses to swap it. Without this, a Reload that
	// installs a new client between Auth returning and this update would
	// leave the active client carrying the stale token (Auth only updated
	// the captured `client`, which Reload may have just replaced).
	s.mu.Lock()
	s.token = tok
	s.sessionExpired = false // a successful refresh/login supersedes any prior expiry
	s.client.SetAuth(tok.AccessToken, tok.RefreshToken)
	s.mu.Unlock()

	if err := s.store.Save(tok); err != nil {
		s.logger.Error("persist token failed", slog.Any("error", err))
		return tok, fmt.Errorf("persist token: %w", err)
	}
	s.logger.Info("pixiv token refreshed",
		slog.Int64("user_id", tok.UserID),
		slog.Time("expires_at", tok.AccessTokenExpiresAt))
	return tok, nil
}

// refreshToken returns the current refresh token (read-locked).
func (s *Service) refreshToken() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.token.RefreshToken
}

// loop re-runs Auth shortly before the current access token expires.
// Pixiv tokens last one hour; we refresh once less than refreshLeadTime remains.
func (s *Service) loop(ctx context.Context) {
	defer s.wg.Done()
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		s.mu.RLock()
		tok := s.token
		s.mu.RUnlock()
		if tok.RefreshToken == "" {
			continue
		}
		if !tok.AccessTokenExpiresAt.IsZero() && time.Until(tok.AccessTokenExpiresAt) > refreshLeadTime {
			continue
		}
		// Outcome handling (clear-on-reject for a revoked token, retry log for a
		// transient failure) lives in refreshSessionLocked.
		_, _ = s.refreshCurrent(ctx)
	}
}

// pixivProbeURL is the host ProbeReachable pings. It's a var (like
// pixivTokenURL) so tests can point it at an httptest server. Any HTTP
// response from it — even a 404 — proves the network path works.
var pixivProbeURL = "https://app-api.pixiv.net/"

// probeTimeout bounds a single reachability probe. Long enough to ride out
// a slow proxy handshake, short enough that a blocked host fails the step
// promptly so the user can reach the proxy input.
const probeTimeout = 8 * time.Second

// authTimeout bounds a user-facing auth operation (token exchange and/or
// refresh). Kept comfortably below server.timeouts.write (default 15s) so an
// unreachable Pixiv fails fast with a clean error: without it, hc.Do hangs
// with no deadline until the server's WriteTimeout tears the connection down
// and the client sees a torn/empty response instead of an error.
const authTimeout = 10 * time.Second

// refreshLeadTime is how long before access-token expiry we proactively
// refresh. The background loop refreshes once the remaining lifetime drops to
// this, and Start skips its boot refresh while the persisted token still has
// more than this left (see needsInitialRefresh).
const refreshLeadTime = 5 * time.Minute

// ProbeReachable reports whether Pixiv is reachable over the network path
// implied by proxy (nil = use the running config's proxy as-is) plus the
// running config's bypass_sni. It builds a throwaway client and never mutates
// the Service, so it's safe to call before login and with a candidate proxy.
//
// A (false, nil) result means the probe ran but no HTTP response came back
// (timeout, DNS failure, refused connection, proxy error) — i.e. unreachable,
// an expected answer rather than a fault. A non-nil error means the probe
// could not even be set up (e.g. SNI-bypass init failed).
func (s *Service) ProbeReachable(ctx context.Context, proxy *string) (bool, time.Duration, error) {
	s.mu.RLock()
	cfg := s.cfg
	s.mu.RUnlock()
	if proxy != nil {
		cfg.Proxy = *proxy
	}

	_, httpc, err := buildClient(cfg)
	if err != nil {
		return false, 0, err
	}

	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, pixivProbeURL, nil)
	if err != nil {
		return false, 0, err
	}
	req.Header.Set("User-Agent", pixivAppUserAgent)

	start := time.Now()
	resp, err := httpc.Do(req)
	elapsed := time.Since(start)
	if err != nil {
		return false, elapsed, nil
	}
	resp.Body.Close()
	return true, elapsed, nil
}

// buildClient constructs a pixivgo client with proxy / bypass settings
// applied. It does NOT authenticate. The second return is the raw
// *http.Client backing the pixivgo client (or http.DefaultClient when neither
// proxy nor SNI-bypass is configured) so callers can reuse the same network
// path for OAuth flows pixivgo doesn't cover.
func buildClient(cfg config.PixivConfig) (*pixivgo.Client, *http.Client, error) {
	opts := []pixivgo.Option{}

	if cfg.BypassSNI {
		hc, base, err := bypass.NewHTTPClient(context.Background())
		if err != nil {
			return nil, nil, fmt.Errorf("init sni bypass: %w", err)
		}
		opts = append(opts, pixivgo.WithHTTPClient(hc), pixivgo.WithBaseURL(base))
		return pixivgo.NewClient(opts...), hc, nil
	}

	if cfg.Proxy != "" {
		u, err := url.Parse(cfg.Proxy)
		if err != nil {
			return nil, nil, fmt.Errorf("parse pixiv proxy %q: %w", cfg.Proxy, err)
		}
		hc := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(u)}}
		opts = append(opts, pixivgo.WithHTTPClient(hc))
		return pixivgo.NewClient(opts...), hc, nil
	}
	return pixivgo.NewClient(opts...), http.DefaultClient, nil
}
