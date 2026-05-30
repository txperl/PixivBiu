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
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/txperl/pixivgo"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/pixiv"
)

// dlState bundles the download config with the objects derived from it
// (template renderer, HTTP client) behind a single atomic.Pointer. Hot
// paths load it once for a consistent, lock-free snapshot; Reload swaps
// in a freshly-built state. An in-flight download keeps using the state
// it loaded when it started, so a config change never mutates a running
// transfer's client or templates mid-flight.
type dlState struct {
	cfg      config.DownloadConfig
	renderer *Renderer
	client   *http.Client
	proxyURL string // pixiv.proxy reused for image fetches; tracked to detect changes
}

// Manager owns the download queue, worker pool, job index, and
// persistence. All public methods are safe for concurrent use.
type Manager struct {
	state atomic.Pointer[dlState]

	logger   *slog.Logger
	pixiv    *pixiv.Service
	store    *Store
	pub      *Publisher
	execRoot string
	homeDir  string

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
//
// root anchors a relative download.output_dir and populates
// NameContext.Root; the composition root computes it once
// (runtimepath.Root) and injects it here.
func NewManager(
	cfg config.DownloadConfig,
	proxyURL string,
	logger *slog.Logger,
	svc *pixiv.Service,
	store *Store,
	pub *Publisher,
	root string,
) (*Manager, error) {
	renderer, err := NewRenderer(cfg, root)
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
		logger:   logger,
		pixiv:    svc,
		store:    store,
		pub:      pub,
		execRoot: root,
		homeDir:  HomeDir(),
		jobs:     jobs,
		queue:    make(chan *Task, qSize),
	}
	m.state.Store(&dlState{cfg: cfg, renderer: renderer, client: client, proxyURL: proxyURL})
	return m, nil
}

// conf returns the current download config snapshot. Lock-free; the
// returned value is a copy safe to read without holding any lock.
func (m *Manager) conf() config.DownloadConfig { return m.state.Load().cfg }

// Reload swaps in download config that changed at runtime, rebuilding
// the template renderer and HTTP client. proxyURL is pixiv.proxy, reused
// for image fetches. Restart-only fields (max_concurrent, store_file)
// are pinned to the running values — the worker pool and store path are
// fixed for the process lifetime — so a change to only those is a no-op
// here. Build-before-commit: on any build error the running state is
// left untouched and the error returned, so the caller can log and keep
// serving the previous good config.
func (m *Manager) Reload(cfg config.DownloadConfig, proxyURL string) error {
	cur := m.state.Load()
	cfg.MaxConcurrent = cur.cfg.MaxConcurrent
	cfg.StoreFile = cur.cfg.StoreFile
	if cfg == cur.cfg && proxyURL == cur.proxyURL {
		return nil
	}

	renderer, err := NewRenderer(cfg, m.execRoot)
	if err != nil {
		return fmt.Errorf("rebuild renderer: %w", err)
	}
	client, err := buildHTTPClient(cfg.HTTPTimeout, proxyURL)
	if err != nil {
		return fmt.Errorf("rebuild http client: %w", err)
	}
	m.state.Store(&dlState{cfg: cfg, renderer: renderer, client: client, proxyURL: proxyURL})
	return nil
}

// Start spawns the worker pool and re-enqueues any tasks that were
// in flight when the process last stopped (status queued or running).
// `running` is reset to `queued` because we don't do resume-in-place.
func (m *Manager) Start(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	m.ctx = ctx
	m.stopFn = cancel

	workers := m.conf().MaxConcurrent
	if workers < 1 {
		workers = 1
	}
	m.wg.Add(workers)
	for i := 0; i < workers; i++ {
		go m.runWorker(ctx)
	}

	m.mu.Lock()
	var toReenqueue []*Task
	// SortedJobs gives a deterministic walk so two restarts of the
	// same on-disk state always assign the same collision suffixes.
	reserved := map[string]struct{}{}
	for _, job := range SortedJobs(m.jobs) {
		var hasNonTerminal bool
		for _, t := range job.Tasks {
			if t.Status == StatusRunning {
				t.Status = StatusQueued
				t.DownloadedBytes = 0
			}
			if t.Status == StatusQueued {
				toReenqueue = append(toReenqueue, t)
			}
			if !t.Status.IsTerminal() {
				hasNonTerminal = true
			}
		}
		job.Status = aggregateStatus(job.Tasks)
		if hasNonTerminal {
			m.resolveJobCollisionsLocked(job, reserved)
		}
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

// ListFilter selects, orders, and paginates jobs for ListPage.
type ListFilter struct {
	// Statuses restricts the result to jobs whose status is in the
	// slice. nil/empty = no status filter.
	Statuses []Status
	// UpdatedSince restricts the result to jobs whose UpdatedAt is at
	// or after this instant. Zero time = no time filter.
	UpdatedSince time.Time
	// Page is 1-based; values < 1 are clamped to 1.
	Page int
	// PerPage is clamped to [1, 100]; 0 defaults to 20.
	PerPage int
}

// ListPage filters, sorts (newest first), and paginates jobs.
// Returned items are deep-copy snapshots — safe to marshal without
// holding m.mu. `total` counts jobs matching the filter; `active`
// (queued+running) and `done` (completed) are GLOBAL aggregates
// independent of the filter, so one call can drive both the page
// view and sidebar/sheet badges.
func (m *Manager) ListPage(filter ListFilter) (items []*Job, total, active, done int) {
	page, perPage := NormalizePagination(filter.Page, filter.PerPage)

	var statusSet map[Status]struct{}
	if len(filter.Statuses) > 0 {
		statusSet = make(map[Status]struct{}, len(filter.Statuses))
		for _, s := range filter.Statuses {
			statusSet[s] = struct{}{}
		}
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	matched := make([]*Job, 0, len(m.jobs))
	for _, j := range m.jobs {
		switch j.Status {
		case StatusQueued, StatusRunning:
			active++
		case StatusCompleted:
			done++
		}
		if statusSet != nil {
			if _, ok := statusSet[j.Status]; !ok {
				continue
			}
		}
		if !filter.UpdatedSince.IsZero() && j.UpdatedAt.Before(filter.UpdatedSince) {
			continue
		}
		matched = append(matched, j)
	}
	slices.SortFunc(matched, func(a, b *Job) int {
		return b.CreatedAt.Compare(a.CreatedAt)
	})
	total = len(matched)

	// Bail before computing `start` so adversarial `page` values (close to
	// MaxInt) can't overflow (page-1)*perPage into a negative or wrapped slice index.
	if total == 0 || page > (total-1)/perPage+1 {
		return []*Job{}, total, active, done
	}

	start := (page - 1) * perPage
	end := start + perPage
	if end > total {
		end = total
	}
	items = make([]*Job, 0, end-start)
	for _, j := range matched[start:end] {
		items = append(items, m.snapshotJobLocked(j))
	}
	return items, total, active, done
}

// Counts returns the global aggregates without sorting or snapshotting
// jobs. Used by the SSE publisher to inline counts into job lifecycle
// events. Cheap because it's a single RLock'd scan.
func (m *Manager) Counts() (active, done int) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, j := range m.jobs {
		switch j.Status {
		case StatusQueued, StatusRunning:
			active++
		case StatusCompleted:
			done++
		}
	}
	return active, done
}

// NormalizePagination clamps user-supplied paging params to safe values.
// Exported so the HTTP handler can echo the same effective page/per_page
// the manager will use, without duplicating the rules.
func NormalizePagination(page, perPage int) (int, int) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 20
	}
	if perPage > 100 {
		perPage = 100
	}
	return page, perPage
}

// publishJobStateChange wraps Publisher.JobStateChange to inline the
// current global counts. Call after m.mu has been released so Counts()
// can take its own RLock.
func (m *Manager) publishJobStateChange(snap *Job) {
	active, done := m.Counts()
	m.pub.JobStateChange(snap, active, done)
}

func (m *Manager) publishJobDeleted(jobID string, illustID int64, taskCount int) {
	active, done := m.Counts()
	m.pub.JobDeleted(jobID, illustID, taskCount, active, done)
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
	changedSnaps := make([]*Task, 0, len(job.Tasks))
	for _, t := range job.Tasks {
		if !transitionTaskTerminalLocked(t, StatusCancelled, "") {
			continue
		}
		// t.cancel is set at lease time; only running tasks have a
		// non-nil handle. Queued tasks are cancelled by the status
		// flip alone (the worker's pre-execute IsTerminal check
		// drops them).
		if t.cancel != nil {
			t.cancel()
		}
		changedSnaps = append(changedSnaps, snapshotTaskLocked(t))
	}
	cleanupPaths, jobSnap, changed := m.transitionJobLocked(job)
	m.mu.Unlock()

	// Persist before deleting files: if we crash between the two, an
	// orphan file is benign; the inverse (files gone + stored status
	// still running) would re-enqueue on restart and silently re-download
	// what the user just cancelled.
	_ = m.persist()
	m.removeCleanupPaths(cleanupPaths)
	for _, s := range changedSnaps {
		m.pub.TaskStateChange(s)
	}
	if changed {
		m.publishJobStateChange(jobSnap)
	}
	return nil
}

// Remove deletes a terminal job from the store. Non-terminal jobs
// must be Cancel'd first. Download List is a history log — Remove
// touches the record only and never the filesystem. Files belonging
// to a failed/cancelled job are already gone via transactional
// cleanup; files of a completed job stay on disk and must be removed
// by the user in a file manager.
func (m *Manager) Remove(id string) error {
	m.mu.Lock()
	job, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return ErrNotFound
	}
	if !job.Status.IsTerminal() {
		m.mu.Unlock()
		return ErrStillRunning
	}
	jobID := job.ID
	illustID := job.IllustID
	taskCount := len(job.Tasks)
	delete(m.jobs, id)
	m.mu.Unlock()

	_ = m.persist()
	m.publishJobDeleted(jobID, illustID, taskCount)
	return nil
}

// RemoveTerminal deletes every job whose status is terminal and (when
// statuses is non-empty) appears in statuses. Empty/nil statuses
// defaults to the full terminal set. Returns ErrNonTerminalStatus if
// any input status is non-terminal. Same record-only contract as Remove.
//
// Counts inlined into every job.deleted event are computed ONCE after
// the bulk delete, so the burst carries identical final numbers
// instead of N intermediate snapshots.
func (m *Manager) RemoveTerminal(statuses []Status) (int, error) {
	var allowed map[Status]struct{}
	if len(statuses) > 0 {
		allowed = make(map[Status]struct{}, len(statuses))
		for _, s := range statuses {
			if !s.IsTerminal() {
				return 0, ErrNonTerminalStatus
			}
			allowed[s] = struct{}{}
		}
	}

	type deletion struct {
		jobID     string
		illustID  int64
		taskCount int
	}
	var deletions []deletion

	m.mu.Lock()
	for id, job := range m.jobs {
		if !job.Status.IsTerminal() {
			continue
		}
		if allowed != nil {
			if _, ok := allowed[job.Status]; !ok {
				continue
			}
		}
		deletions = append(deletions, deletion{
			jobID:     job.ID,
			illustID:  job.IllustID,
			taskCount: len(job.Tasks),
		})
		delete(m.jobs, id)
	}
	m.mu.Unlock()

	if len(deletions) == 0 {
		return 0, nil
	}
	_ = m.persist()

	active, done := m.Counts()
	for _, d := range deletions {
		m.pub.JobDeleted(d.jobID, d.illustID, d.taskCount, active, done)
	}
	return len(deletions), nil
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
		PreviewURL: rewritePximg(pickPreviewURL(info.ImageUrls), m.conf().PximgBase),
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
		Home:      m.homeDir,
		Root:      m.execRoot,
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
	m.resolveJobCollisionsLocked(job, m.reservedPathsLocked())
	m.jobs[jobID] = job
	jobSnap := m.snapshotJobLocked(job)
	m.mu.Unlock()
	if err := m.persist(); err != nil {
		m.logger.Warn("download persist failed", slog.Any("error", err))
	}
	m.publishJobStateChange(jobSnap)

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
	st := m.state.Load()
	outputDir, err := st.renderer.RenderRootPath(st.renderer.OutputDir, baseCtx)
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
		relPath, err := st.renderer.RenderRelativePath(st.renderer.FileName, ctxCopy)
		if err != nil {
			return err
		}
		full := filepath.Join(outputDir, relPath)
		job.Tasks = append(job.Tasks, &Task{
			ID:        newID("tsk_"),
			JobID:     job.ID,
			URL:       rewritePximg(url, st.cfg.PximgBase),
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
		relPath, err := st.renderer.RenderRelativePath(st.renderer.FileGroup, ctxCopy)
		if err != nil {
			return err
		}
		full := filepath.Join(outputDir, relPath)
		job.Tasks = append(job.Tasks, &Task{
			ID:        newID("tsk_"),
			JobID:     job.ID,
			URL:       rewritePximg(url, st.cfg.PximgBase),
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
	st := m.state.Load()
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
	// Pin the format so a later hot-reload can't change the conversion
	// output out from under the path reserved here.
	job.UgoiraFormat = st.cfg.Ugoira.Format

	outputDir, err := st.renderer.RenderRootPath(st.renderer.OutputDir, baseCtx)
	if err != nil {
		return err
	}

	ctxCopy := baseCtx
	ctxCopy.Index = 0
	ctxCopy.Ext = ugoiraFinalExt(job.UgoiraFormat)
	relPath, err := st.renderer.RenderRelativePath(st.renderer.FileName, ctxCopy)
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
		URL:       rewritePximg(zipURL, st.cfg.PximgBase),
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
		m.publishJobStateChange(jobSnap)
	}
	return job, true
}

// runDownloadWithRetries runs the HTTP fetch with exponential backoff.
// On success, non-ugoira tasks move to completed; ugoira stays running
// for post-processing. Failure/cancel set the terminal state here.
func (m *Manager) runDownloadWithRetries(taskCtx, parent context.Context, task *Task, isUgoira bool) error {
	// Snapshot config + client once per task: an in-flight transfer keeps
	// the retry policy, referer, and HTTP client it started with even if
	// Reload swaps in new ones mid-download.
	st := m.state.Load()
	maxRetries := st.cfg.Retry.Max
	if maxRetries < 0 {
		maxRetries = 0
	}
	base := st.cfg.Retry.InitialBackoff
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
			st.client,
			task.URL,
			st.cfg.Referer,
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
			// Backfill SizeBytes when upstream omitted Content-Length, so the
			// terminal task.progress event (and any persisted snapshot) carry
			// a real total instead of -1.
			if atomic.LoadInt64(&task.SizeBytes) <= 0 && written > 0 {
				atomic.StoreInt64(&task.SizeBytes, written)
			}
			m.mu.Lock()
			// Mark before the status transition so a racing Cancel
			// sees our ownership and the inline cleanup below the
			// lock removes the right file.
			task.WroteFile = true
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
				if isUgoira {
					// Make WroteFile durable before the slow ugoira
					// convert — a crash mid-encode otherwise lets the
					// next boot's collision resolver bump the zip.
					_ = m.persist()
				}
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
		// Cancel won; drop the converted artefact. The source zip
		// is already gone — unavoidable.
		_ = os.Remove(orphanPath)
	}
	if convErr != nil && !cancelled {
		m.logger.Warn("ugoira convert failed",
			slog.String("job_id", job.ID),
			slog.Any("error", convErr))
	}
}

// finalizeTask persists the terminal task, publishes the task event,
// then re-aggregates the parent job via transitionJobLocked. Any
// cleanup paths returned by the aggregate transition are removed
// outside the lock per the transactional-job contract.
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
	cleanupPaths, jobSnap, changed := m.transitionJobLocked(job)
	m.mu.Unlock()

	// Persist the terminal aggregate before deleting files. See
	// Manager.Cancel for the crash-window rationale.
	if changed {
		_ = m.persist()
	}
	m.removeCleanupPaths(cleanupPaths)
	if changed {
		m.publishJobStateChange(jobSnap)
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

// transitionJobLocked recomputes job.Status. Single entry point for
// Job-level transitions; caller does the IO outside m.mu.
// Returns:
//   - cleanupPaths: non-nil when aggregate transitioned to failed/cancelled
//   - snap: non-nil iff status changed
//   - changed: gates persistence and event publication
//
// Caller must hold m.mu (write).
func (m *Manager) transitionJobLocked(job *Job) (cleanupPaths []string, snap *Job, changed bool) {
	old := job.Status
	job.Status = aggregateStatus(job.Tasks)
	job.UpdatedAt = time.Now().UTC()
	if old == job.Status {
		return nil, nil, false
	}
	snap = m.snapshotJobLocked(job)
	if job.Status == StatusFailed || job.Status == StatusCancelled {
		cleanupPaths = writtenPaths(job.Tasks)
	}
	return cleanupPaths, snap, true
}

// writtenPaths returns the FilePath of every task with WroteFile set.
// See Task.WroteFile for the ownership rationale. Caller must hold m.mu.
func writtenPaths(tasks []*Task) []string {
	out := make([]string, 0, len(tasks))
	for _, t := range tasks {
		if t.WroteFile && t.FilePath != "" {
			out = append(out, t.FilePath)
		}
	}
	return out
}

// finalPathLocked returns the eventual on-disk artefact path for a
// task — equal to FilePath for images and for already-converted
// ugoira, but swapped to the configured final extension when the
// task is mid-flight ugoira still holding its `.zip` intermediate.
// Caller must hold m.mu.
func (m *Manager) finalPathLocked(job *Job, task *Task) string {
	if task.FilePath == "" {
		return ""
	}
	if job == nil || job.IllustType != IllustTypeUgoira {
		return task.FilePath
	}
	finalExt := ugoiraFinalExt(job.UgoiraFormat)
	if finalExt == ".zip" || !isZipPath(task.FilePath) {
		return task.FilePath
	}
	return replaceExt(task.FilePath, finalExt)
}

// isZipPath reports whether path ends with a case-insensitive ".zip".
// Used to distinguish ugoira's transient download target from its
// post-conversion final artefact.
func isZipPath(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".zip")
}

// reservedPathsLocked collects the set of final on-disk paths owned
// by every non-terminal task across all jobs. Seeds the collision
// resolver so a new Submit cannot hand out a path that another
// in-flight job will eventually land on. Terminal tasks are excluded:
// completed files are on disk (caught by os.Stat in ResolveCollision)
// and failed/cancelled files are already cleaned up. Caller must hold
// m.mu.
func (m *Manager) reservedPathsLocked() map[string]struct{} {
	out := make(map[string]struct{})
	for _, job := range m.jobs {
		for _, t := range job.Tasks {
			if t.Status.IsTerminal() {
				continue
			}
			p := m.finalPathLocked(job, t)
			if p != "" {
				out[p] = struct{}{}
			}
		}
	}
	return out
}

// resolveJobCollisionsLocked rewrites each non-terminal task's
// FilePath so it cannot collide with files on disk, paths in
// `reserved`, or sibling tasks in this same job. Reserved is updated
// in-place. For ugoira tasks still on the `.zip` intermediate, the
// stem is suffixed but the `.zip` is retained so the post-download
// `replaceExt` lands on the resolved final name. Caller must hold m.mu.
func (m *Manager) resolveJobCollisionsLocked(job *Job, reserved map[string]struct{}) {
	for _, t := range job.Tasks {
		if t.Status.IsTerminal() {
			continue
		}
		if t.WroteFile {
			// We already own the file at FilePath (e.g. ugoira zip
			// downloaded before a shutdown interrupted conversion).
			// Resolving would orphan it; reserve our paths and skip.
			if t.FilePath != "" {
				reserved[t.FilePath] = struct{}{}
			}
			if final := m.finalPathLocked(job, t); final != "" {
				reserved[final] = struct{}{}
			}
			continue
		}
		candidate := m.finalPathLocked(job, t)
		if candidate == "" {
			continue
		}
		if isZipPath(t.FilePath) && !isZipPath(candidate) {
			// Both paths must share a suffix so the worker's `.zip`
			// write and the post-conversion artefact stay collision-free.
			resolvedFinal, resolvedZip := ResolveCollisionPair(candidate, ".zip", reserved)
			reserved[resolvedFinal] = struct{}{}
			reserved[resolvedZip] = struct{}{}
			t.FilePath = resolvedZip
			continue
		}
		resolved := ResolveCollision(candidate, reserved)
		reserved[resolved] = struct{}{}
		t.FilePath = resolved
	}
}

// removeCleanupPaths os.Removes each path, logging non-ENOENT errors
// without aborting the loop. Caller must release m.mu first.
func (m *Manager) removeCleanupPaths(paths []string) {
	for _, p := range paths {
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			m.logger.Warn("download cleanup failed",
				slog.String("path", p),
				slog.Any("error", err))
		}
	}
}

// convertUgoira dispatches to the encoder in ugoira.go. `none` /
// empty format skips conversion — the zip stays on disk. ctx is the
// per-task context, so Cancel() and Shutdown() interrupt encoding.
func (m *Manager) convertUgoira(ctx context.Context, job *Job, task *Task) error {
	format := UgoiraFormat(strings.ToLower(job.UgoiraFormat))
	if format == "" || format == UgoiraFormatNone {
		return nil
	}
	finalPath, err := ConvertUgoira(ctx, task.FilePath, job.UgoiraFrames, format)
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
	cp := &Task{
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
		WroteFile:       t.WroteFile,
	}
	return cp
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
