package api

import (
	"net/http"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/pixiv"
)

func (h *APIHandler) SearchIllusts(w http.ResponseWriter, r *http.Request, params SearchIllustsParams) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	resp, err := pixiv.Call(r.Context(), h.svc, func(c *pixivgo.Client) (*pixivgo.SearchIllustrations, error) {
		return c.SearchIllust(r.Context(), pixivgo.SearchIllustParams{
			Word:         params.Word,
			SearchTarget: pixivgo.SearchTarget(derefEnum(params.SearchTarget)),
			Sort:         pixivgo.Sort(derefEnum(params.Sort)),
			Duration:     durationOpt(params.Duration),
			StartDate:    params.StartDate,
			EndDate:      params.EndDate,
			Filter:       pixivgo.Filter(derefEnum(params.ClientMode)),
			SearchAIType: excludeAIOpt(params.ExcludeAi),
			Offset:       i64OptToIntOpt(params.Offset),
		})
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, IllustPage{
		Illusts:    resp.Illusts,
		NextOffset: pixiv.NextOffset(resp.NextURL),
	})
}

func (h *APIHandler) SearchUsers(w http.ResponseWriter, r *http.Request, params SearchUsersParams) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	resp, err := pixiv.Call(r.Context(), h.svc, func(c *pixivgo.Client) (*pixivgo.UserListResponse, error) {
		return c.SearchUser(r.Context(), pixivgo.SearchUserParams{
			Word:     params.Word,
			Sort:     pixivgo.Sort(derefEnum(params.Sort)),
			Duration: durationOpt(params.Duration),
			Filter:   pixivgo.Filter(derefEnum(params.ClientMode)),
			Offset:   i64OptToIntOpt(params.Offset),
		})
	})
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, UserPreviewPage{
		UserPreviews: resp.UserPreviews,
		NextOffset:   pixiv.NextOffset(resp.NextURL),
	})
}

func durationOpt(p *DurationQuery) *pixivgo.Duration {
	if p == nil {
		return nil
	}
	d := pixivgo.Duration(*p)
	return &d
}

func excludeAIOpt(p *ExcludeAiQuery) *int {
	if p == nil || !*p {
		return nil
	}
	v := 1
	return &v
}
