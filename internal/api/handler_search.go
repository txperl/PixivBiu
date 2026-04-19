package api

import (
	"net/http"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/pixiv"
)

func (h *APIHandler) SearchIllusts(w http.ResponseWriter, r *http.Request, params SearchIllustsParams) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	resp, err := h.svc.Client().SearchIllust(r.Context(), pixivgo.SearchIllustParams{
		Word:         params.Word,
		SearchTarget: pixivgo.SearchTarget(derefEnum(params.SearchTarget)),
		Sort:         pixivgo.Sort(derefEnum(params.Sort)),
		Offset:       i64OptToIntOpt(params.Offset),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, IllustPage{
		Illusts:    resp.Illusts,
		NextOffset: pixiv.NextOffset(resp.NextURL),
	})
}

func (h *APIHandler) SearchUsers(w http.ResponseWriter, r *http.Request, params SearchUsersParams) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	resp, err := h.svc.Client().SearchUser(r.Context(), pixivgo.SearchUserParams{
		Word:   params.Word,
		Offset: i64OptToIntOpt(params.Offset),
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
