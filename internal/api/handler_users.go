package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/pixiv"
)

func (h *APIHandler) ListUserIllusts(w http.ResponseWriter, r *http.Request, id UserIdPath, params ListUserIllustsParams) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	resp, err := h.svc.Client().UserIllusts(r.Context(), pixivgo.UserIllustsParams{
		UserID: int(id),
		Type:   pixivgo.IllustType(derefEnum(params.Type)),
		Offset: i64OptToIntOpt(params.Offset),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, UserIllustsPage{
		User:       resp.User,
		Illusts:    resp.Illusts,
		NextOffset: pixiv.NextOffset(resp.NextURL),
	})
}

func (h *APIHandler) ListUserBookmarks(w http.ResponseWriter, r *http.Request, id UserIdPath, params ListUserBookmarksParams) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	resp, err := h.svc.Client().UserBookmarksIllust(r.Context(), pixivgo.UserBookmarksIllustParams{
		UserID:        int(id),
		Restrict:      pixivgo.Restrict(derefEnum(params.Restrict)),
		MaxBookmarkID: i64OptToIntOpt(params.MaxBookmarkId),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, IllustPage{
		Illusts:           resp.Illusts,
		NextMaxBookmarkId: pixiv.NextMaxBookmarkID(resp.NextURL),
	})
}

func (h *APIHandler) ListUserFollowing(w http.ResponseWriter, r *http.Request, id UserIdPath, params ListUserFollowingParams) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	resp, err := h.svc.Client().UserFollowing(r.Context(), pixivgo.UserFollowingParams{
		UserID:   int(id),
		Restrict: pixivgo.Restrict(derefEnum(params.Restrict)),
		Offset:   i64OptToIntOpt(params.Offset),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, UserPreviewPage{
		UserPreviews: resp.UserPreviews,
		NextOffset:   pixiv.NextOffset(resp.NextURL),
	})
}

func (h *APIHandler) AddFollow(w http.ResponseWriter, r *http.Request, id UserIdPath) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	restrict := pixivgo.RestrictPublic
	var body FollowRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		h.writeError(w, r, err)
		return
	}
	if body.Restrict != nil {
		restrict = pixivgo.Restrict(*body.Restrict)
	}
	if err := h.svc.Client().UserFollowAdd(r.Context(), pixivgo.UserFollowAddParams{
		UserID:   int(id),
		Restrict: restrict,
	}); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) DeleteFollow(w http.ResponseWriter, r *http.Request, id UserIdPath) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	if err := h.svc.Client().UserFollowDelete(r.Context(), pixivgo.UserFollowDeleteParams{
		UserID: int(id),
	}); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
