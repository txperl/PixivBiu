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
	writeJSON(w, http.StatusOK, makeAuthStatus(tok))
}

func (h *APIHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Logout(); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) GetAuthStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, makeAuthStatus(h.svc.Snapshot()))
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
	writeJSON(w, http.StatusOK, makeAuthStatus(tok))
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

// makeAuthStatus projects an internal state.Token onto the generated AuthStatus
// model. A blank access token means the server is logged out.
func makeAuthStatus(tok state.Token) AuthStatus {
	if tok.AccessToken == "" {
		return AuthStatus{Authenticated: false}
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
