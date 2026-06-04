package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/txperl/PixivBiu/internal/pixiv"
	"github.com/txperl/PixivBiu/internal/state"
)

func (h *APIHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		WriteError(w, r, err)
		return
	}
	if req.RefreshToken == "" {
		WriteError(w, r, pixiv.ErrNoRefreshToken)
		return
	}
	tok, err := h.svc.Login(r.Context(), req.RefreshToken)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, makeAuthStatus(tok, false))
}

func (h *APIHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Logout(); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) GetAuthStatus(w http.ResponseWriter, r *http.Request) {
	tok, sessionExpired := h.svc.AuthSnapshot()
	writeJSON(w, http.StatusOK, makeAuthStatus(tok, sessionExpired))
}

// StartOAuth issues a fresh PKCE state + verifier and hands the client back
// the hosted Pixiv login URL. The verifier stays server-side; the client only
// needs `state` to call ExchangeOAuth.
func (h *APIHandler) StartOAuth(w http.ResponseWriter, r *http.Request) {
	state, _, challenge, err := h.pkce.Issue()
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, OAuthStartResponse{
		State:    state,
		LoginUrl: pixiv.BuildLoginURL(challenge),
	})
}

// ExchangeOAuth completes the OAuth flow: it pulls the verifier the server
// stored under `state`, asks Pixiv to trade the authorisation code for tokens,
// and persists the result through the same path as plain refresh-token login.
// `code` may be either the bare code or the full callback URL the user
// pasted from the popup's address bar.
func (h *APIHandler) ExchangeOAuth(w http.ResponseWriter, r *http.Request) {
	var req OAuthExchangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		WriteError(w, r, err)
		return
	}
	code := extractAuthCode(req.Code)
	if code == "" {
		WriteError(w, r, pixiv.ErrNoAuthCode)
		return
	}
	verifier, err := h.pkce.Consume(req.State)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	tok, err := h.svc.LoginWithAuthCode(r.Context(), code, verifier)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, makeAuthStatus(tok, false))
}

// CheckConnectivity probes whether Pixiv is reachable over the backend's
// current network path, optionally testing a candidate proxy. It is
// deliberately unauthenticated: the login onboarding calls it before sign-in so
// a user on a restricted network can discover — and fix, via a proxy — a dead
// connection before wrestling with the OAuth popup.
//
// reachable=false is a normal 200 result (the answer to the question), not an
// error. When a supplied proxy works AND there's no Pixiv session yet, the
// proxy is persisted so the imminent OAuth login uses it. That write is bounded
// to the pre-login window: once authenticated, proxy changes belong on the
// (auth-gated) Settings page, so we skip persisting here.
func (h *APIHandler) CheckConnectivity(w http.ResponseWriter, r *http.Request) {
	var req CheckConnectivityJSONRequestBody
	if err := decodeJSON(r, &req); err != nil {
		WriteError(w, r, err)
		return
	}

	var override *string
	if req.Proxy != nil {
		p := strings.TrimSpace(*req.Proxy)
		override = &p
	}

	reachable, latency, err := h.svc.ProbeReachable(r.Context(), override)
	if err != nil {
		WriteError(w, r, err)
		return
	}

	if reachable && override != nil {
		if err := h.persistOnboardingProxy(*override); err != nil {
			WriteError(w, r, err)
			return
		}
	}

	ms := int(latency.Milliseconds())
	writeJSON(w, http.StatusOK, ConnectivityStatus{Reachable: reachable, LatencyMs: &ms})
}

// persistOnboardingProxy records a proxy the connectivity probe just proved
// works, so the imminent OAuth login uses it. It is a deliberate no-op once a
// Pixiv session exists: after login, proxy changes go through the auth-gated
// Settings page (PATCH /config), not this open endpoint. The write hot-reloads
// the live client via the config manager's OnReload hooks (cmd/server/main.go)
// before the client proceeds to OAuth.
func (h *APIHandler) persistOnboardingProxy(proxy string) error {
	if h.svc.Authenticated() {
		return nil
	}
	_, err := h.cfgMgr.Patch(map[string]any{"pixiv": map[string]any{"proxy": proxy}})
	return err
}

// extractAuthCode tolerates the user pasting either the full Pixiv callback
// URL or just the bare code. Anything that looks like a URL is parsed first;
// otherwise we trust the trimmed input.
func extractAuthCode(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "pixiv://") {
		if u, err := url.Parse(s); err == nil {
			if c := u.Query().Get("code"); c != "" {
				return c
			}
		}
	}
	return s
}

// makeAuthStatus projects an internal state.Token (+ the session-expired flag)
// onto the generated AuthStatus model. The refresh token is the session — a
// blank refresh token means logged out, and sessionExpired then distinguishes a
// revoked session from a never-logged-in first run. An expired access token
// still reads as authenticated: the service renews it transparently (background
// loop + on-401 self-heal); only a permanent refresh rejection (invalid_grant)
// clears the refresh token.
func makeAuthStatus(tok state.Token, sessionExpired bool) AuthStatus {
	if tok.RefreshToken == "" {
		s := AuthStatus{Authenticated: false}
		if sessionExpired {
			v := true
			s.SessionExpired = &v
		}
		return s
	}
	s := AuthStatus{Authenticated: true}
	if tok.UserID != 0 {
		v := tok.UserID
		s.UserId = &v
	}
	if tok.UserName != "" {
		v := tok.UserName
		s.UserName = &v
	}
	if !tok.AccessTokenExpiresAt.IsZero() {
		v := tok.AccessTokenExpiresAt
		s.ExpiresAt = &v
	}
	return s
}
