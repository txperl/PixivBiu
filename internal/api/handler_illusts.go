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
	resp, err := h.svc.BookmarkDetail(r.Context(), int(id))
	if err != nil {
		WriteError(w, r, err)
		return
	}
	if resp.BookmarkDetail.Tags == nil {
		resp.BookmarkDetail.Tags = []pixivgo.BookmarkTag{}
	}
	writeJSON(w, http.StatusOK, resp.BookmarkDetail)
}

func (h *APIHandler) AddBookmark(w http.ResponseWriter, r *http.Request, id IllustIdPath) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	var fields map[string]json.RawMessage
	decoder := json.NewDecoder(r.Body)
	err := decoder.Decode(&fields)
	if err != nil && !errors.Is(err, io.EOF) {
		WriteError(w, r, err)
		return
	}
	if err == nil {
		if fields == nil {
			WriteError(w, r, &ValidationError{Fields: map[string]string{"_": "Expected an object."}})
			return
		}
		if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
			WriteError(w, r, &ValidationError{Fields: map[string]string{"_": "Expected one JSON object."}})
			return
		}
	}
	var update pixiv.BookmarkUpdate
	if raw, ok := fields["restrict"]; ok {
		var value Restrict
		if err := json.Unmarshal(raw, &value); err != nil {
			WriteError(w, r, err)
			return
		}
		if value != "public" && value != "private" {
			WriteError(w, r, &ValidationError{Fields: map[string]string{"restrict": "Choose public or private."}})
			return
		}
		v := pixivgo.Restrict(value)
		update.Restrict = &v
	}
	if raw, ok := fields["tags"]; ok {
		var tags []string
		if err := json.Unmarshal(raw, &tags); err != nil {
			WriteError(w, r, err)
			return
		}
		if tags == nil {
			WriteError(w, r, &ValidationError{Fields: map[string]string{"tags": "Expected an array, not null."}})
			return
		}
		tags, err = pixiv.NormalizeBookmarkTags(tags)
		if err != nil {
			WriteError(w, r, err)
			return
		}
		update.Tags = &tags
	}
	if err := h.svc.SaveBookmark(r.Context(), int(id), update); err != nil {
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
	if err := h.svc.DeleteBookmark(r.Context(), int(id)); err != nil {
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
