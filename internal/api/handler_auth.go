package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/txperl/PixivBiu/internal/pixiv"
	"github.com/txperl/PixivBiu/internal/state"
)

func (h *APIHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		h.writeError(w, r, err)
		return
	}
	if req.RefreshToken == "" {
		h.writeError(w, r, pixiv.ErrNoRefreshToken)
		return
	}
	tok, err := h.svc.Login(r.Context(), req.RefreshToken)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, makeAuthStatus(tok))
}

func (h *APIHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Logout(); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) GetAuthStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, makeAuthStatus(h.svc.Snapshot()))
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
