package download

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/pixiv"
)

// Manager owns the download queue, worker pool, job index, and
// persistence. All public methods are safe for concurrent use.
type Manager struct {
	cfg      config.DownloadConfig
	logger   *slog.Logger
	pixiv    *pixiv.Service
	store    *Store
	pub      *Publisher
	renderer *Renderer
	client   *http.Client

	mu   sync.RWMutex
	jobs map[string]*Job

	queue  chan *Task
	wg     sync.WaitGroup
	ctx    context.Context
	stopFn context.CancelFunc

	// saveMu binds "take snapshot" and "write file" into one atomic
	// unit, so a stale snapshot can't land on top of a fresher one.
	saveMu sync.Mutex
}

// NewManager wires the manager and loads any persisted job index.
// It does not spawn workers — call Start for that.
//
// proxyURL is reused from pixiv.proxy. bypass_sni is intentionally not
// plumbed: its DoH client only resolves the API host, not i.pximg.net.
func NewManager(
	cfg config.DownloadConfig,
	proxyURL string,
	logger *slog.Logger,
	svc *pixiv.Service,
	store *Store,
	pub *Publisher,
) (*Manager, error) {
	renderer, err := NewRenderer(cfg)
	if err != nil {
		return nil, fmt.Errorf("build renderer: %w", err)
	}

	jobs, err := store.Load()
	if err != nil {
		return nil, fmt.Errorf("load download store: %w", err)
	}

	client, err := buildHTTPClient(cfg.HTTPTimeout, proxyURL)
	if err != nil {
		return nil, fmt.Errorf("build http client: %w", err)
	}

	qSize := cfg.MaxConcurrent * 4
	if qSize < 8 {
		qSize = 8
	}

	m := &Manager{
		cfg:      cfg,
		logger:   logger,
		pixiv:    svc,
		store:    store,
		pub:      pub,
		renderer: renderer,
		client:   client,
		jobs:     jobs,
		queue:    make(chan *Task, qSize),
	}
	return m, nil
}

// Start spawns the worker pool and re-enqueues any tasks that were
// in flight when the process last stopped (status queued or running).
// `running` is reset to `queued` because we don't do resume-in-place.
func (m *Manager) Start(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	m.ctx = ctx
	m.stopFn = cancel

	workers := m.cfg.MaxConcurrent
	if workers < 1 {
		workers = 1
	}
	m.wg.Add(workers)
	for i := 0; i < workers; i++ {
		go m.runWorker(ctx)
	}

	m.mu.Lock()
	var toReenqueue []*Task
	for _, job := range m.jobs {
		for _, t := range job.Tasks {
			if t.Status == StatusRunning {
				t.Status = StatusQueued
				t.DownloadedBytes = 0
			}
			if t.Status == StatusQueued {
				toReenqueue = append(toReenqueue, t)
			}
		}
		job.Status = aggregateStatus(job.Tasks)
	}
	m.mu.Unlock()
	_ = m.persist()

	// Async: a large recovery set would otherwise block server boot on
	// the bounded queue. Tasks stay queued in store, so a crash mid-drain
	// recovers through this same path next boot.
	m.enqueueAsync(toReenqueue)
}

// Shutdown cancels the worker context, waits for all workers to
// drain, and flushes the store one last time.
func (m *Manager) Shutdown() {
	if m.stopFn != nil {
		m.stopFn()
	}
	m.wg.Wait()
	_ = m.persist()
}

// List returns a snapshot of jobs, newest first. Each Job (and its
// Tasks) in the returned slice is an independent deep copy, safe to
// read and marshal without holding m.mu.
func (m *Manager) List() []*Job {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make(map[string]*Job, len(m.jobs))
	for id, j := range m.jobs {
		out[id] = m.snapshotJobLocked(j)
	}
	return SortedJobs(out)
}

// Get returns a deep-copy snapshot of one job by ID. See List.
func (m *Manager) Get(id string) (*Job, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	job, ok := m.jobs[id]
	if !ok {
		return nil, ErrNotFound
	}
	return m.snapshotJobLocked(job), nil
}

// Cancel moves non-terminal tasks in a job to cancelled, cancels any
// in-flight HTTP, and publishes the lifecycle events. Terminal jobs
// return ErrAlreadyTerminal.
func (m *Manager) Cancel(id string) error {
	m.mu.Lock()
	job, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return ErrNotFound
	}
	if job.Status.IsTerminal() {
		m.mu.Unlock()
		return ErrAlreadyTerminal
	}
	now := time.Now().UTC()
	changedSnaps := make([]*Task, 0, len(job.Tasks))
	for _, t := range job.Tasks {
		if t.Status.IsTerminal() {
			continue
		}
		t.Status = StatusCancelled
		t.FinishedAt = now
		if t.cancel != nil {
			t.cancel()
		}
		changedSnaps = append(changedSnaps, snapshotTaskLocked(t))
	}
	job.Status = StatusCancelled
	job.UpdatedAt = now
	jobSnap := m.snapshotJobLocked(job)
	m.mu.Unlock()

	_ = m.persist()
	for _, s := range changedSnaps {
		m.pub.TaskStateChange(s)
	}
	m.pub.JobStateChange(jobSnap)
	return nil
}

// Submit creates a Job for the given illust ID. It fetches the
// illust detail, builds tasks per page (single / multi / ugoira),
// enqueues them, and returns the Job. The returned Job is the live
// pointer; callers must not mutate it.
func (m *Manager) Submit(ctx context.Context, illustID int64) (*Job, error) {
	client := m.pixiv.Client()
	if client == nil {
		return nil, pixiv.ErrNotAuthenticated
	}
	detail, err := client.IllustDetail(ctx, pixivgo.IllustDetailParams{IllustID: int(illustID)})
	if err != nil {
		return nil, fmt.Errorf("fetch illust %d: %w", illustID, err)
	}
	info := detail.Illust

	illustType := IllustType(info.Type)
	now := time.Now().UTC()
	jobID := newID("job_")

	job := &Job{
		ID:         jobID,
		IllustID:   illustID,
		IllustType: illustType,
		Title:      info.Title,
		Status:     StatusQueued,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	// Pre-sanitise user-supplied fields so a pixiv title like
	// "weird/name" cannot sneak in a subdirectory via {{.Title}}.
	// Literal `/` in a template still behaves as a path separator —
	// that's the author's explicit choice. Function `sanitize` is
	// also exposed for templates that want an additional pass.
	baseCtx := NameContext{
		IllustID:  illustID,
		Title:     Sanitize(info.Title),
		Type:      info.Type,
		UserID:    int64(info.User.ID),
		UserName:  Sanitize(info.User.Name),
		CreatedAt: parsePixivTime(info.CreateDate),
		Now:       now.Local(),
		Home:      HomeDir(),
		Root:      ExecRoot(),
	}

	switch illustType {
	case IllustTypeUgoira:
		if err := m.buildUgoiraTasks(ctx, job, baseCtx); err != nil {
			return nil, err
		}
	default:
		if err := m.buildImageTasks(info, job, baseCtx); err != nil {
			return nil, err
		}
	}

	if len(job.Tasks) == 0 {
		return nil, ErrInvalidIllust
	}

	m.mu.Lock()
	m.jobs[jobID] = job
	jobSnap := m.snapshotJobLocked(job)
	m.mu.Unlock()
	if err := m.persist(); err != nil {
		m.logger.Warn("download persist failed", slog.Any("error", err))
	}
	m.pub.JobStateChange(jobSnap)

	// Async: the bounded queue would otherwise make Submit block on any
	// job whose task count exceeds free capacity, breaking the 202 contract.
	m.enqueueAsync(job.Tasks)
	// Workers may already be mutating job; snapshot so callers see a
	// stable view (same contract as List/Get).
	m.mu.RLock()
	snap := m.snapshotJobLocked(job)
	m.mu.RUnlock()
	return snap, nil
}

// enqueueAsync pushes tasks onto m.queue from a wg-tracked goroutine so
// callers never see channel back-pressure. m.ctx.Done aborts cleanly.
func (m *Manager) enqueueAsync(tasks []*Task) {
	if len(tasks) == 0 {
		return
	}
	m.wg.Go(func() {
		for _, t := range tasks {
			select {
			case m.queue <- t:
			case <-m.ctx.Done():
				return
			}
		}
	})
}

// buildImageTasks populates `job.Tasks` for single- or multi-page
// illusts / manga.
func (m *Manager) buildImageTasks(info pixivgo.IllustrationInfo, job *Job, baseCtx NameContext) error {
	outputDir, err := m.renderer.RenderRootPath(m.renderer.OutputDir, baseCtx)
	if err != nil {
		return err
	}

	if len(info.MetaPages) == 0 {
		// Single-page illust. Use meta_single_page.original_image_url.
		url := ""
		if info.MetaSinglePage.OriginalImageURL != nil {
			url = *info.MetaSinglePage.OriginalImageURL
		}
		if url == "" {
			url = info.ImageUrls.Large
		}
		if url == "" {
			return ErrInvalidIllust
		}
		ctxCopy := baseCtx
		ctxCopy.Index = 0
		ctxCopy.Ext = ExtFromURL(url)
		relPath, err := m.renderer.RenderRelativePath(m.renderer.FileName, ctxCopy)
		if err != nil {
			return err
		}
		full := filepath.Join(outputDir, relPath)
		job.Tasks = append(job.Tasks, &Task{
			ID:        newID("tsk_"),
			JobID:     job.ID,
			URL:       rewritePximg(url, m.cfg.PximgBase),
			FilePath:  full,
			Status:    StatusQueued,
			SizeBytes: -1,
		})
		return nil
	}

	// Multi-page illust / manga. pixivgo's ImageUrls unfortunately
	// does not expose `original` for meta_pages entries, so Large is
	// our best available resolution without patching pixivgo.
	for i, page := range info.MetaPages {
		url := page.ImageUrls.Large
		if url == "" {
			url = page.ImageUrls.Medium
		}
		if url == "" {
			continue
		}
		ctxCopy := baseCtx
		ctxCopy.Index = i + 1
		ctxCopy.Ext = ExtFromURL(url)
		relPath, err := m.renderer.RenderRelativePath(m.renderer.FileGroup, ctxCopy)
		if err != nil {
			return err
		}
		full := filepath.Join(outputDir, relPath)
		job.Tasks = append(job.Tasks, &Task{
			ID:        newID("tsk_"),
			JobID:     job.ID,
			URL:       rewritePximg(url, m.cfg.PximgBase),
			FilePath:  full,
			Status:    StatusQueued,
			SizeBytes: -1,
		})
	}
	return nil
}

// buildUgoiraTasks fetches ugoira metadata and builds a single task
// that downloads the frame zip. The conversion (zip → webp/gif) is
// triggered by the worker post-download, not as a separate task.
func (m *Manager) buildUgoiraTasks(ctx context.Context, job *Job, baseCtx NameContext) error {
	client := m.pixiv.Client()
	meta, err := client.UgoiraMetadata(ctx, pixivgo.UgoiraMetadataParams{IllustID: int(job.IllustID)})
	if err != nil {
		return fmt.Errorf("ugoira metadata: %w", err)
	}
	zipURL := meta.UgoiraMetadata.ZipUrls.Medium
	if zipURL == "" {
		return ErrInvalidIllust
	}
	// Pixiv's `medium` URL includes `600x600_90_webp` at lower res;
	// swap for the 1920x1080 variant to get full-quality frames.
	zipURL = strings.Replace(zipURL, "600x600", "1920x1080", 1)

	job.UgoiraFrames = make([]UgoiraFrame, 0, len(meta.UgoiraMetadata.Frames))
	for _, f := range meta.UgoiraMetadata.Frames {
		job.UgoiraFrames = append(job.UgoiraFrames, UgoiraFrame{
			File:  f.File,
			Delay: time.Duration(f.Delay) * time.Millisecond,
		})
	}

	outputDir, err := m.renderer.RenderRootPath(m.renderer.OutputDir, baseCtx)
	if err != nil {
		return err
	}

	ctxCopy := baseCtx
	ctxCopy.Index = 0
	ctxCopy.Ext = ugoiraFinalExt(m.cfg.Ugoira.Format)
	relPath, err := m.renderer.RenderRelativePath(m.renderer.FileName, ctxCopy)
	if err != nil {
		return err
	}
	finalPath := filepath.Join(outputDir, relPath)
	// The zip we download has a different extension; the conversion
	// step will swap it for the configured final extension.
	zipPath := strings.TrimSuffix(finalPath, ctxCopy.Ext) + ".zip"

	job.Tasks = append(job.Tasks, &Task{
		ID:        newID("tsk_"),
		JobID:     job.ID,
		URL:       rewritePximg(zipURL, m.cfg.PximgBase),
		FilePath:  zipPath,
		Status:    StatusQueued,
		SizeBytes: -1,
	})
	return nil
}

// runWorker pulls tasks off the queue and executes them.
func (m *Manager) runWorker(ctx context.Context) {
	defer m.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case task := <-m.queue:
			// select is non-deterministic; re-check so shutdown doesn't
			// start new work. Task stays queued for next boot.
			if ctx.Err() != nil {
				return
			}
			m.executeTask(ctx, task)
		}
	}
}

// executeTask: lease → download (retries) → ugoira post (if any) → finalize.
func (m *Manager) executeTask(parent context.Context, task *Task) {
	taskCtx, cancel := context.WithCancel(parent)
	defer cancel()

	job, leased := m.leaseTask(task, cancel)
	if !leased {
		return
	}
	isUgoira := job != nil && job.IllustType == IllustTypeUgoira

	lastErr := m.runDownloadWithRetries(taskCtx, parent, task, isUgoira)

	if isUgoira {
		m.runUgoiraPostProcessing(taskCtx, parent, job, task)
	}

	m.finalizeTask(task, job, lastErr)
}

// leaseTask claims task for this worker, transitioning task (and
// parent job, if still queued) to running. Returns (nil, false) if
// the task was cancelled between enqueue and dequeue. The running
// transition is not persisted: recovery resets running→queued.
func (m *Manager) leaseTask(task *Task, cancel context.CancelFunc) (*Job, bool) {
	m.mu.Lock()
	if task.Status.IsTerminal() {
		m.mu.Unlock()
		return nil, false
	}
	task.cancel = cancel
	task.Status = StatusRunning
	task.StartedAt = time.Now().UTC()
	startSnap := snapshotTaskLocked(task)

	job := m.jobs[task.JobID]
	var jobSnap *Job
	if job != nil && job.Status != StatusRunning {
		job.Status = StatusRunning
		job.UpdatedAt = time.Now().UTC()
		jobSnap = m.snapshotJobLocked(job)
	}
	m.mu.Unlock()

	m.pub.TaskStateChange(startSnap)
	if jobSnap != nil {
		m.pub.JobStateChange(jobSnap)
	}
	return job, true
}

// runDownloadWithRetries runs the HTTP fetch with exponential backoff.
// On success, non-ugoira tasks move to completed; ugoira stays running
// for post-processing. Failure/cancel set the terminal state here.
func (m *Manager) runDownloadWithRetries(taskCtx, parent context.Context, task *Task, isUgoira bool) error {
	maxRetries := m.cfg.Retry.Max
	if maxRetries < 0 {
		maxRetries = 0
	}
	base := m.cfg.Retry.InitialBackoff
	if base <= 0 {
		base = time.Second
	}

	var lastErr error
	attempt := 0
	for {
		attempt++
		// Per-attempt reset, else retry progress accumulates past size.
		atomic.StoreInt64(&task.DownloadedBytes, 0)
		atomic.StoreInt64(&task.lastProgressNs, 0)
		m.mu.Lock()
		task.Error = ""
		m.mu.Unlock()

		_, written, err := httpDownload(
			taskCtx,
			m.client,
			task.URL,
			m.cfg.Referer,
			task.FilePath,
			task.ID,
			func(total int64) {
				atomic.StoreInt64(&task.SizeBytes, total)
			},
			func(delta int64) {
				// Hot path: atomic add + throttled publish. No lock.
				atomic.AddInt64(&task.DownloadedBytes, delta)
				m.pub.TaskProgress(task)
			},
		)
		if err == nil {
			m.mu.Lock()
			var accepted bool
			if isUgoira {
				// Ugoira stays running through conversion; terminal
				// transition happens in runUgoiraPostProcessing.
				accepted = !task.Status.IsTerminal()
			} else {
				accepted = transitionTaskTerminalLocked(task, StatusCompleted, "")
			}
			m.mu.Unlock()
			if accepted {
				atomic.StoreInt64(&task.DownloadedBytes, written)
			} else {
				// Cancel won the lock; drop the freshly-renamed file.
				_ = os.Remove(task.FilePath)
			}
			return nil
		}
		lastErr = err
		if errors.Is(err, context.Canceled) {
			m.mu.Lock()
			resolveCancelled(task, parent)
			m.mu.Unlock()
			return lastErr
		}
		if !isRetryable(err) || attempt > maxRetries {
			m.mu.Lock()
			transitionTaskTerminalLocked(task, StatusFailed, err.Error())
			m.mu.Unlock()
			return lastErr
		}
		select {
		case <-time.After(backoff(attempt, base)):
		case <-taskCtx.Done():
			m.mu.Lock()
			resolveCancelled(task, parent)
			m.mu.Unlock()
			return lastErr
		}
	}
}

// runUgoiraPostProcessing converts the downloaded zip. Task stays
// running so Cancel can interrupt the encoder via taskCtx; a concurrent
// cancel otherwise lets the final aggregation flip back to completed.
func (m *Manager) runUgoiraPostProcessing(taskCtx, parent context.Context, job *Job, task *Task) {
	m.mu.RLock()
	runConvert := !task.Status.IsTerminal()
	m.mu.RUnlock()
	if !runConvert {
		return
	}

	convErr := m.convertUgoira(taskCtx, job, task)
	cancelled := errors.Is(convErr, context.Canceled)

	m.mu.Lock()
	var (
		acceptedSuccess bool
		orphanPath      string
	)
	switch {
	case convErr == nil:
		// Capture the converted path under the lock so a concurrent
		// mutation can't shift the removal target.
		orphanPath = task.FilePath
		acceptedSuccess = transitionTaskTerminalLocked(task, StatusCompleted, "")
	case cancelled:
		resolveCancelled(task, parent)
	default:
		transitionTaskTerminalLocked(task, StatusFailed, fmt.Sprintf("ugoira convert: %v", convErr))
	}
	m.mu.Unlock()

	if convErr == nil && !acceptedSuccess {
		// Cancel won; drop the converted artefact. Source zip is
		// already gone when keep_zip=false — unavoidable.
		_ = os.Remove(orphanPath)
	}
	if convErr != nil && !cancelled {
		m.logger.Warn("ugoira convert failed",
			slog.String("job_id", job.ID),
			slog.Any("error", convErr))
	}
}

// finalizeTask persists the terminal task, publishes the task event,
// then re-aggregates the parent job and publishes on transition.
func (m *Manager) finalizeTask(task *Task, job *Job, lastErr error) {
	m.mu.Lock()
	task.cancel = nil
	endSnap := snapshotTaskLocked(task)
	m.mu.Unlock()

	if lastErr != nil {
		m.logger.Debug("download task ended with error",
			slog.String("task_id", task.ID),
			slog.Any("error", lastErr))
	}

	_ = m.persist()
	m.pub.TaskStateChange(endSnap)

	if job == nil {
		return
	}
	m.mu.Lock()
	oldStatus := job.Status
	job.Status = aggregateStatus(job.Tasks)
	job.UpdatedAt = time.Now().UTC()
	var jobSnap *Job
	if oldStatus != job.Status {
		jobSnap = m.snapshotJobLocked(job)
	}
	m.mu.Unlock()
	if jobSnap != nil {
		_ = m.persist()
		m.pub.JobStateChange(jobSnap)
	}
}

// resolveCancelled settles a context.Canceled: shutdown resets to
// queued so Start() re-enqueues; user cancel marks terminal. Must be
// called with m.mu (write) held.
func resolveCancelled(task *Task, parent context.Context) {
	switch {
	case task.Status.IsTerminal():
	case parent.Err() != nil:
		task.Status = StatusQueued
		atomic.StoreInt64(&task.DownloadedBytes, 0)
	default:
		task.Status = StatusCancelled
		task.FinishedAt = time.Now().UTC()
	}
}

// transitionTaskTerminalLocked sets task to a terminal state, refusing
// the write if it's already terminal. Returning false signals callers
// to skip side-effects so a stale success/failed can't clobber a cancel
// that just won the lock. Caller must hold m.mu (write).
func transitionTaskTerminalLocked(t *Task, to Status, errMsg string) bool {
	if t.Status.IsTerminal() {
		return false
	}
	t.Status = to
	t.FinishedAt = time.Now().UTC()
	t.Error = errMsg
	return true
}

// convertUgoira dispatches to the encoder in ugoira.go. `none` /
// empty format skips conversion — the zip stays on disk. ctx is the
// per-task context, so Cancel() and Shutdown() interrupt encoding.
func (m *Manager) convertUgoira(ctx context.Context, job *Job, task *Task) error {
	format := UgoiraFormat(strings.ToLower(m.cfg.Ugoira.Format))
	if format == "" || format == UgoiraFormatNone {
		return nil
	}
	finalPath, err := ConvertUgoira(ctx, task.FilePath, job.UgoiraFrames, format, m.cfg.Ugoira.KeepZip)
	if err != nil {
		return err
	}
	m.mu.Lock()
	task.FilePath = finalPath
	m.mu.Unlock()
	return nil
}

// persist writes the full index to disk under the save mutex.
// Jobs and Tasks are deep-copied under the read lock so Save can
// marshal them without racing against workers that keep mutating the
// live objects.
func (m *Manager) persist() error {
	m.saveMu.Lock()
	defer m.saveMu.Unlock()

	m.mu.RLock()
	snapshot := make(map[string]*Job, len(m.jobs))
	for id, j := range m.jobs {
		snapshot[id] = m.snapshotJobLocked(j)
	}
	m.mu.RUnlock()

	return m.store.Save(snapshot)
}

// snapshotTaskLocked deep-copies t. Caller must hold m.mu. Fields
// are listed explicitly because a `*t` struct copy would
// non-atomically read SizeBytes / DownloadedBytes — the hot path
// writes those via atomic.* without m.mu.
func snapshotTaskLocked(t *Task) *Task {
	return &Task{
		ID:              t.ID,
		JobID:           t.JobID,
		URL:             t.URL,
		FilePath:        t.FilePath,
		Status:          t.Status,
		SizeBytes:       atomic.LoadInt64(&t.SizeBytes),
		DownloadedBytes: atomic.LoadInt64(&t.DownloadedBytes),
		Error:           t.Error,
		StartedAt:       t.StartedAt,
		FinishedAt:      t.FinishedAt,
	}
}

// snapshotJobLocked deep-copies j and its Tasks. Caller must hold m.mu.
func (m *Manager) snapshotJobLocked(j *Job) *Job {
	jobCopy := *j
	jobCopy.Tasks = make([]*Task, 0, len(j.Tasks))
	for _, t := range j.Tasks {
		jobCopy.Tasks = append(jobCopy.Tasks, snapshotTaskLocked(t))
	}
	if len(j.UgoiraFrames) > 0 {
		jobCopy.UgoiraFrames = append([]UgoiraFrame(nil), j.UgoiraFrames...)
	}
	return &jobCopy
}

// ugoiraFinalExt translates the configured ugoira format into a
// filename extension (leading dot). Panics on an unknown format —
// config.validate rejects those at startup, so reaching the default
// arm means a caller bypassed validation.
func ugoiraFinalExt(format string) string {
	switch strings.ToLower(format) {
	case "webp":
		return ".webp"
	case "gif":
		return ".gif"
	case "", "none":
		return ".zip"
	}
	panic(fmt.Sprintf("ugoira: ugoiraFinalExt called with unvalidated format %q", format))
}

// parsePixivTime parses Pixiv's ISO8601 create_date field. Returns
// zero time on parse error so templates can use `{{.CreatedAt | date
// "..."}}` without blowing up.
func parsePixivTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t.Local()
}

// newID returns a short random identifier with a typed prefix.
// 10 bytes of entropy is enough for our scale (rough collision
// probability after 1M IDs ≈ 2^-60).
func newID(prefix string) string {
	var buf [10]byte
	if _, err := rand.Read(buf[:]); err != nil {
		// Extremely unlikely; fall back to a time-based ID.
		return fmt.Sprintf("%s%d", prefix, time.Now().UnixNano())
	}
	return prefix + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf[:]))
}
