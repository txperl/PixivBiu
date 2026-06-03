package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/pixiv"
)

func (h *APIHandler) GetIllust(w http.ResponseWriter, r *http.Request, id IllustIdPath) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	resp, err := pixiv.Call(r.Context(), h.svc, func(c *pixivgo.Client) (*pixivgo.IllustDetailResponse, error) {
		return c.IllustDetail(r.Context(), pixivgo.IllustDetailParams{
			IllustID: int(id),
		})
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *APIHandler) GetUgoiraMetadata(w http.ResponseWriter, r *http.Request, id IllustIdPath) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	resp, err := pixiv.Call(r.Context(), h.svc, func(c *pixivgo.Client) (*pixivgo.UgoiraMetadataResponse, error) {
		return c.UgoiraMetadata(r.Context(), pixivgo.UgoiraMetadataParams{
			IllustID: int(id),
		})
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *APIHandler) ListRanking(w http.ResponseWriter, r *http.Request, params ListRankingParams) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	resp, err := pixiv.Call(r.Context(), h.svc, func(c *pixivgo.Client) (*pixivgo.IllustListResponse, error) {
		return c.IllustRanking(r.Context(), pixivgo.IllustRankingParams{
			Mode:   pixivgo.RankingMode(derefEnum(params.Mode)),
			Filter: pixivgo.Filter(derefEnum(params.ClientMode)),
			Date:   params.Date,
			Offset: i64OptToIntOpt(params.Offset),
		})
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, illustListPage(resp))
}

func (h *APIHandler) ListRecommended(w http.ResponseWriter, r *http.Request, params ListRecommendedParams) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	resp, err := pixiv.Call(r.Context(), h.svc, func(c *pixivgo.Client) (*pixivgo.IllustListResponse, error) {
		return c.IllustRecommended(r.Context(), pixivgo.IllustRecommendedParams{
			ContentType:           pixivgo.IllustType(derefEnum(params.Type)),
			Filter:                pixivgo.Filter(derefEnum(params.ClientMode)),
			IncludeRankingIllusts: params.IncludeRankingIllusts,
			Offset:                i64OptToIntOpt(params.Offset),
		})
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, illustListPage(resp))
}

func (h *APIHandler) ListFollowingIllusts(w http.ResponseWriter, r *http.Request, params ListFollowingIllustsParams) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	resp, err := pixiv.Call(r.Context(), h.svc, func(c *pixivgo.Client) (*pixivgo.IllustListResponse, error) {
		return c.IllustFollow(r.Context(), pixivgo.IllustFollowParams{
			Restrict: pixivgo.Restrict(derefEnum(params.Restrict)),
			Offset:   i64OptToIntOpt(params.Offset),
		})
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, illustListPage(resp))
}

func (h *APIHandler) GetBookmarkDetail(w http.ResponseWriter, r *http.Request, id IllustIdPath) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	resp, err := pixiv.Call(r.Context(), h.svc, func(c *pixivgo.Client) (*pixivgo.BookmarkDetailResponse, error) {
		return c.IllustBookmarkDetail(r.Context(), pixivgo.IllustBookmarkDetailParams{
			IllustID: int(id),
		})
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, BookmarkDetail{
		IsBookmarked: resp.BookmarkDetail.IsBookmarked,
		Restrict:     Restrict(resp.BookmarkDetail.Restrict),
	})
}

func (h *APIHandler) AddBookmark(w http.ResponseWriter, r *http.Request, id IllustIdPath) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	restrict := pixivgo.RestrictPublic
	var body BookmarkRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		WriteError(w, r, err)
		return
	}
	if body.Restrict != nil {
		restrict = pixivgo.Restrict(*body.Restrict)
	}
	if err := pixiv.Exec(r.Context(), h.svc, func(c *pixivgo.Client) error {
		return c.IllustBookmarkAdd(r.Context(), pixivgo.IllustBookmarkAddParams{
			IllustID: int(id),
			Restrict: restrict,
		})
	}); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) DeleteBookmark(w http.ResponseWriter, r *http.Request, id IllustIdPath) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	if err := pixiv.Exec(r.Context(), h.svc, func(c *pixivgo.Client) error {
		return c.IllustBookmarkDelete(r.Context(), pixivgo.IllustBookmarkDeleteParams{
			IllustID: int(id),
		})
	}); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// illustListPage adapts pixivgo's list response into our IllustPage wrapper,
// extracting the `offset` cursor from next_url so callers don't need to parse
// pixiv internals.
func illustListPage(resp *pixivgo.IllustListResponse) IllustPage {
	return IllustPage{
		Illusts:    resp.Illusts,
		NextOffset: pixiv.NextOffset(resp.NextURL),
	}
}
