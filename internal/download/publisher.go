package download

import (
	"sync/atomic"
	"time"

	"github.com/txperl/PixivBiu/internal/inbox"
)

// Event topic and type constants, centralised so handlers and the
// frontend reference the same names. Wire format: `<topic>.<type>`
// in the SSE `event:` line, full envelope in `data:`.
const (
	TopicDownload = "download"

	TypeJobQueued     = "job.queued"
	TypeJobStarted    = "job.started"
	TypeJobCompleted  = "job.completed"
	TypeJobFailed     = "job.failed"
	TypeJobCancelled  = "job.cancelled"
	TypeJobDeleted    = "job.deleted"
	TypeTaskStarted   = "task.started"
	TypeTaskProgress  = "task.progress"
	TypeTaskCompleted = "task.completed"
	TypeTaskFailed    = "task.failed"
	TypeTaskCancelled = "task.cancelled"
)

// Publisher wraps the generic inbox.Publisher with download-specific
// helpers: compact event payloads, a centralised naming scheme, and
// per-task progress throttling so a thousand io.Copy chunks don't
// each become an SSE frame.
//
// Throttle state lives on the Task itself (`lastProgressNs`), not in
// a map on the publisher — so there is no separate cleanup path when
// a task is forgotten, and progress on a hot copy loop never contends
// for a global lock.
type Publisher struct {
	hub      inbox.Publisher
	interval time.Duration
}

// NewPublisher builds a publisher gated by `interval`. An interval
// <= 0 disables throttling (every Progress call publishes).
func NewPublisher(hub inbox.Publisher, interval time.Duration) *Publisher {
	return &Publisher{
		hub:      hub,
		interval: interval,
	}
}

// progressPayload is the JSON body of a task.progress event.
type progressPayload struct {
	JobID      string `json:"job_id"`
	TaskID     string `json:"task_id"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
}

type taskEventPayload struct {
	JobID    string `json:"job_id"`
	TaskID   string `json:"task_id"`
	URL      string `json:"url,omitempty"`
	FilePath string `json:"file_path,omitempty"`
	Error    string `json:"error,omitempty"`
}

type jobEventPayload struct {
	JobID     string `json:"job_id"`
	IllustID  int64  `json:"illust_id,omitempty"`
	TaskCount int    `json:"task_count,omitempty"`
	Error     string `json:"error,omitempty"`
}

// TaskProgress publishes an intermediate progress event, skipping if
// the previous publish for the same task happened within `interval`.
// Callers should invoke TaskStateChange on the terminal transition;
// that call flushes a final progress tick independent of throttling.
//
// The throttle decision is lock-free: a CAS on the task's own
// lastProgressNs atomic picks a single publisher per interval even
// under concurrent calls.
func (p *Publisher) TaskProgress(task *Task) {
	if task == nil {
		return
	}
	if p.interval > 0 {
		now := time.Now().UnixNano()
		last := atomic.LoadInt64(&task.lastProgressNs)
		if now-last < int64(p.interval) {
			return
		}
		if !atomic.CompareAndSwapInt64(&task.lastProgressNs, last, now) {
			// Another goroutine won this interval; let it publish.
			return
		}
	}

	p.hub.Publish(TopicDownload, TypeTaskProgress, progressPayload{
		JobID:      task.JobID,
		TaskID:     task.ID,
		Downloaded: atomic.LoadInt64(&task.DownloadedBytes),
		Total:      atomic.LoadInt64(&task.SizeBytes),
	})
}

// TaskStateChange publishes an event matching task.Status. Pass a
// snapshotTaskLocked copy — Publisher reads its own memory, no lock.
// Bypasses the progress throttle so UI sees the 0%/100% boundaries.
func (p *Publisher) TaskStateChange(task *Task) {
	if task == nil {
		return
	}
	payload := taskEventPayload{
		JobID:    task.JobID,
		TaskID:   task.ID,
		URL:      task.URL,
		FilePath: task.FilePath,
		Error:    task.Error,
	}
	prog := progressPayload{
		JobID:      task.JobID,
		TaskID:     task.ID,
		Downloaded: task.DownloadedBytes,
		Total:      task.SizeBytes,
	}
	switch task.Status {
	case StatusRunning:
		p.hub.Publish(TopicDownload, TypeTaskStarted, payload)
		p.hub.Publish(TopicDownload, TypeTaskProgress, prog)
	case StatusCompleted:
		p.hub.Publish(TopicDownload, TypeTaskProgress, prog)
		p.hub.Publish(TopicDownload, TypeTaskCompleted, payload)
	case StatusFailed:
		p.hub.Publish(TopicDownload, TypeTaskFailed, payload)
	case StatusCancelled:
		p.hub.Publish(TopicDownload, TypeTaskCancelled, payload)
	}
}

// JobStateChange publishes a job-level event. Pass a snapshotJobLocked
// copy. Call after per-task events so clients see tasks-then-aggregate.
func (p *Publisher) JobStateChange(job *Job) {
	if job == nil {
		return
	}
	payload := jobEventPayload{
		JobID:     job.ID,
		IllustID:  job.IllustID,
		TaskCount: len(job.Tasks),
	}
	if job.Status == StatusFailed {
		for _, t := range job.Tasks {
			if t.Error != "" {
				payload.Error = t.Error
				break
			}
		}
	}
	switch job.Status {
	case StatusQueued:
		p.hub.Publish(TopicDownload, TypeJobQueued, payload)
	case StatusRunning:
		p.hub.Publish(TopicDownload, TypeJobStarted, payload)
	case StatusCompleted:
		p.hub.Publish(TopicDownload, TypeJobCompleted, payload)
	case StatusFailed:
		p.hub.Publish(TopicDownload, TypeJobFailed, payload)
	case StatusCancelled:
		p.hub.Publish(TopicDownload, TypeJobCancelled, payload)
	}
}

func (p *Publisher) JobDeleted(jobID string, illustID int64, taskCount int) {
	p.hub.Publish(TopicDownload, TypeJobDeleted, jobEventPayload{
		JobID:     jobID,
		IllustID:  illustID,
		TaskCount: taskCount,
	})
}
