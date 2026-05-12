// Package download implements the download manager, worker pool, and
// JSON-backed task store for pixiv artwork downloads. It publishes
// progress and lifecycle events via an inbox.Publisher so the HTTP
// layer (SSE in our case) remains transport-agnostic.
package download

import (
	"context"
	"errors"
	"time"
)

// Status is the lifecycle state of a Job or a Task. The valid
// transitions are:
//
//	queued → running → {completed | failed | cancelled}
//
// A Job's aggregate status is computed from its tasks in the
// worst-case-wins direction (cancelled > failed > running > queued >
// completed).
type Status string

const (
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
	StatusCancelled Status = "cancelled"
)

// IsTerminal reports whether the status is a final state (no further
// transition possible without a new Job).
func (s Status) IsTerminal() bool {
	return s == StatusCompleted || s == StatusFailed || s == StatusCancelled
}

// IllustType mirrors pixiv's work types we need to route on.
type IllustType string

const (
	IllustTypeIllust IllustType = "illust"
	IllustTypeManga  IllustType = "manga"
	IllustTypeUgoira IllustType = "ugoira"
)

// Task is a single HTTP GET → file unit of work.
//
// DownloadedBytes is updated atomically from the download hot path
// (every ~32 KiB chunk) via atomic.AddInt64 — no manager lock is
// required per chunk. Readers should use atomic.LoadInt64 unless
// they already hold Manager.mu for other fields of the same task.
type Task struct {
	ID              string    `json:"id"`
	JobID           string    `json:"job_id"`
	URL             string    `json:"url"`
	FilePath        string    `json:"file_path"`
	Status          Status    `json:"status"`
	SizeBytes       int64     `json:"size_bytes"`       // -1 when upstream omits Content-Length
	DownloadedBytes int64     `json:"downloaded_bytes"` // atomic; see type doc
	Error           string    `json:"error,omitempty"`
	StartedAt       time.Time `json:"started_at,omitzero"`
	FinishedAt      time.Time `json:"finished_at,omitzero"`

	// WroteFile records whether the worker has renamed a downloaded
	// payload onto FilePath. httpDownload writes to a `.part` tempfile
	// and atomic-renames on success; before that rename FilePath may
	// hold an intact file from an earlier job at the same deterministic
	// path. Cleanup gates on this flag so it only deletes files this
	// task actually wrote.
	WroteFile bool `json:"wrote_file,omitempty"`

	// Runtime-only (not serialised).
	cancel context.CancelFunc `json:"-"`
	// lastProgressNs is a UnixNano timestamp of the last published
	// progress event for this task, used by Publisher for per-task
	// throttling without a global map. Accessed via atomic ops only.
	lastProgressNs int64 `json:"-"`
}

// Job is the user-visible unit: one illust (possibly multi-page) or
// one ugoira turns into one Job with 1+ Tasks.
type Job struct {
	ID         string     `json:"id"`
	IllustID   int64      `json:"illust_id"`
	IllustType IllustType `json:"illust_type"`
	Title      string     `json:"title"`
	Status     Status     `json:"status"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	Tasks      []*Task    `json:"tasks"`

	// Ugoira-only fields populated on Submit; used by the worker's
	// post-download conversion step.
	UgoiraFrames []UgoiraFrame `json:"ugoira_frames,omitempty"`
}

// UgoiraFrame is the per-frame timing metadata from
// pixivgo.UgoiraMetadata, kept in our own shape so the store's JSON
// layout is insulated from pixivgo changes.
type UgoiraFrame struct {
	File  string        `json:"file"`
	Delay time.Duration `json:"delay"`
}

// Sentinel errors. See internal/api/handler.go::classify for how the
// HTTP layer maps these.
var (
	ErrNotFound        = errors.New("download: job not found")
	ErrAlreadyTerminal = errors.New("download: job already in terminal state")
	ErrStillRunning    = errors.New("download: job is still running — cancel it first")
	ErrInvalidIllust   = errors.New("download: illust has no downloadable content")
	ErrNotImplemented  = errors.New("download: feature not implemented")
)

// aggregateStatus computes a Job's status from its tasks using the
// worst-case-wins rule. Empty task list is treated as queued to keep
// the state machine honest before Submit finishes populating tasks.
func aggregateStatus(tasks []*Task) Status {
	if len(tasks) == 0 {
		return StatusQueued
	}
	var anyRunning, anyQueued, anyFailed, anyCancelled bool
	allDone := true
	for _, t := range tasks {
		switch t.Status {
		case StatusCancelled:
			anyCancelled = true
			allDone = false
		case StatusFailed:
			anyFailed = true
			allDone = false
		case StatusRunning:
			anyRunning = true
			allDone = false
		case StatusQueued:
			anyQueued = true
			allDone = false
		case StatusCompleted:
			// ok
		}
	}
	switch {
	case anyCancelled:
		return StatusCancelled
	case anyFailed && !anyRunning && !anyQueued:
		return StatusFailed
	case anyRunning:
		return StatusRunning
	case anyQueued:
		return StatusQueued
	case allDone:
		return StatusCompleted
	default:
		// Mixed failed + queued shouldn't happen (failed is terminal
		// per-task), but be defensive.
		return StatusRunning
	}
}
