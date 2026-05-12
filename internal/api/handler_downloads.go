package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync/atomic"

	"github.com/txperl/PixivBiu/internal/download"
)

func (h *APIHandler) SubmitDownload(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	var body SubmitDownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		h.writeError(w, r, err)
		return
	}
	if body.IllustId <= 0 {
		h.writeError(w, r, download.ErrInvalidIllust)
		return
	}
	job, err := h.dl.Submit(r.Context(), body.IllustId)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, projectJob(job))
}

func (h *APIHandler) ListDownloads(w http.ResponseWriter, r *http.Request) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	jobs := h.dl.List()
	out := DownloadJobList{Jobs: make([]DownloadJob, 0, len(jobs))}
	for _, j := range jobs {
		out.Jobs = append(out.Jobs, projectJob(j))
	}
	writeJSON(w, http.StatusOK, out)
}

func (h *APIHandler) GetDownload(w http.ResponseWriter, r *http.Request, id DownloadIdPath) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	job, err := h.dl.Get(id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, projectJob(job))
}

func (h *APIHandler) CancelDownload(w http.ResponseWriter, r *http.Request, id DownloadIdPath) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	if err := h.dl.Cancel(id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *APIHandler) RemoveDownload(w http.ResponseWriter, r *http.Request, id DownloadIdPath) {
	if err := h.requireAuth(); err != nil {
		h.writeError(w, r, err)
		return
	}
	if err := h.dl.Remove(id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
