package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/txperl/PixivBiu/internal/download"
)

var allDownloadStatuses = map[download.Status]struct{}{
	download.StatusQueued:    {},
	download.StatusRunning:   {},
	download.StatusCompleted: {},
	download.StatusFailed:    {},
	download.StatusCancelled: {},
}

// parseStatusList parses the `status` csv query param into a Status
// slice. Empty/nil = nil result (no filter). Unknown values produce
// an error that the handler maps to 400.
func parseStatusList(raw *string) ([]download.Status, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	parts := strings.Split(*raw, ",")
	out := make([]download.Status, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		s := download.Status(p)
		if _, ok := allDownloadStatuses[s]; !ok {
			return nil, &UnknownStatusError{Value: p}
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

func (h *APIHandler) SubmitDownload(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	var body SubmitDownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		WriteError(w, r, err)
		return
	}
	if body.IllustId <= 0 {
		WriteError(w, r, download.ErrInvalidIllust)
		return
	}
	job, err := h.dl.Submit(r.Context(), body.IllustId)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, projectJob(job))
}

func (h *APIHandler) ListDownloads(w http.ResponseWriter, r *http.Request, params ListDownloadsParams) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}

	statuses, err := parseStatusList(params.Status)
	if err != nil {
		WriteError(w, r, err)
		return
	}

	filter := download.ListFilter{Statuses: statuses}
	if params.Page != nil {
		filter.Page = *params.Page
	}
	if params.PerPage != nil {
		filter.PerPage = *params.PerPage
	}
	if params.UpdatedSince != nil {
		filter.UpdatedSince = *params.UpdatedSince
	}

	items, total, active, done := h.dl.ListPage(filter)
	jobs := make([]DownloadJob, 0, len(items))
	for _, j := range items {
		jobs = append(jobs, projectJob(j))
	}
	effPage, effPerPage := download.NormalizePagination(filter.Page, filter.PerPage)
	writeJSON(w, http.StatusOK, DownloadJobList{
		Jobs:        jobs,
		Total:       total,
		Page:        effPage,
		PerPage:     effPerPage,
		ActiveCount: active,
		DoneCount:   done,
	})
}

func (h *APIHandler) GetDownload(w http.ResponseWriter, r *http.Request, id DownloadIdPath) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	job, err := h.dl.Get(id)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, projectJob(job))
}

func (h *APIHandler) CancelDownload(w http.ResponseWriter, r *http.Request, id DownloadIdPath) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	if err := h.dl.Cancel(id); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) RemoveDownload(w http.ResponseWriter, r *http.Request, id DownloadIdPath) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	if err := h.dl.Remove(id); err != nil {
		WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) ClearDownloads(w http.ResponseWriter, r *http.Request, params ClearDownloadsParams) {
	if err := h.requireAuth(); err != nil {
		WriteError(w, r, err)
		return
	}
	statuses, err := parseStatusList(params.Status)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	removed, err := h.dl.RemoveTerminal(statuses)
	if err != nil {
		WriteError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, ClearDownloadsResponse{Removed: removed})
}

// projectJob adapts an internal *download.Job to the generated
// DownloadJob wire type. The mapping copies per-request so workers
// that keep mutating the underlying job don't race with marshalling.
func projectJob(j *download.Job) DownloadJob {
	title := j.Title
	out := DownloadJob{
		Id:         j.ID,
		IllustId:   j.IllustID,
		IllustType: DownloadIllustType(j.IllustType),
		Status:     DownloadStatus(j.Status),
		CreatedAt:  j.CreatedAt,
		UpdatedAt:  j.UpdatedAt,
		Tasks:      make([]DownloadTask, 0, len(j.Tasks)),
	}
	if title != "" {
		out.Title = &title
	}
	if j.PreviewURL != "" {
		p := j.PreviewURL
		out.PreviewUrl = &p
	}
	for _, t := range j.Tasks {
		out.Tasks = append(out.Tasks, projectTask(t))
	}
	return out
}

func projectTask(t *download.Task) DownloadTask {
	task := DownloadTask{
		Id:              t.ID,
		JobId:           t.JobID,
		Url:             t.URL,
		FilePath:        t.FilePath,
		Status:          DownloadStatus(t.Status),
		SizeBytes:       atomic.LoadInt64(&t.SizeBytes),
		DownloadedBytes: atomic.LoadInt64(&t.DownloadedBytes),
	}
	if t.Error != "" {
		e := t.Error
		task.Error = &e
	}
	if !t.StartedAt.IsZero() {
		s := t.StartedAt
		task.StartedAt = &s
	}
	if !t.FinishedAt.IsZero() {
		f := t.FinishedAt
		task.FinishedAt = &f
	}
	return task
}
