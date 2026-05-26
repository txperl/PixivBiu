package download

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/inbox"
)

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	cfg := config.DownloadConfig{
		OutputDir:         t.TempDir(),
		FileTemplate:      `{{.IllustID}}{{.Ext}}`,
		FileGroupTemplate: `{{.IllustID}}_{{.Index}}{{.Ext}}`,
		MaxConcurrent:     1,
		HTTPTimeout:       5 * time.Second,
		Retry:             config.RetryConfig{Max: 2, InitialBackoff: 5 * time.Millisecond},
		PximgBase:         "https://i.pximg.net",
		StoreFile:         filepath.Join(t.TempDir(), "downloads.json"),
	}
	hub := inbox.NewHub(64)
	pub := NewPublisher(hub, 0)
	logger := slog.New(slog.DiscardHandler)
	m, err := NewManager(cfg, "", logger, nil, NewStore(cfg.StoreFile), pub)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return m
}

// setUgoiraFormat swaps the live download state's ugoira format,
// reusing the existing renderer/client. Mirrors how Reload installs a
// new dlState; lets tests tweak one field without rebuilding by hand.
func setUgoiraFormat(m *Manager, format string) {
	st := m.state.Load()
	cfg := st.cfg
	cfg.Ugoira.Format = format
	m.state.Store(&dlState{cfg: cfg, renderer: st.renderer, client: st.client, proxyURL: st.proxyURL})
}

func TestTransitionTaskTerminalLocked_RespectsExistingTerminal(t *testing.T) {
	for _, existing := range []Status{StatusCancelled, StatusFailed, StatusCompleted} {
		task := &Task{Status: existing, Error: "preserved"}
		if ok := transitionTaskTerminalLocked(task, StatusCompleted, "overwrite"); ok {
			t.Errorf("from %s: expected no transition, got ok=true", existing)
		}
		if task.Status != existing {
			t.Errorf("from %s: status mutated to %s", existing, task.Status)
		}
		if task.Error != "preserved" {
			t.Errorf("from %s: error mutated to %q", existing, task.Error)
		}
	}
}

func TestTransitionTaskTerminalLocked_TransitionsFromActive(t *testing.T) {
	for _, existing := range []Status{StatusQueued, StatusRunning} {
		task := &Task{Status: existing}
		ok := transitionTaskTerminalLocked(task, StatusFailed, "boom")
		if !ok {
			t.Errorf("from %s: expected transition", existing)
		}
		if task.Status != StatusFailed {
			t.Errorf("from %s: status not set", existing)
		}
		if task.Error != "boom" {
			t.Errorf("from %s: error not set", existing)
		}
		if task.FinishedAt.IsZero() {
			t.Errorf("from %s: FinishedAt not stamped", existing)
		}
	}
}

// Regression: DownloadedBytes used to accumulate across retries.
func TestExecuteTask_RetryResetsProgressCounter(t *testing.T) {
	body := []byte("a payload long enough that a half-write is observable")
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := attempts.Add(1)
		if n == 1 {
			// Half-write then hijack-close to force a retry.
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			w.WriteHeader(http.StatusOK)
			half := len(body) / 2
			_, _ = w.Write(body[:half])
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			hj, ok := w.(http.Hijacker)
			if !ok {
				t.Errorf("hijacker not supported")
				return
			}
			conn, _, err := hj.Hijack()
			if err == nil {
				_ = conn.Close()
			}
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)

	m := newTestManager(t)
	dest := filepath.Join(t.TempDir(), "out.bin")
	task := &Task{
		ID: "tsk_retry", JobID: "job_retry",
		URL: srv.URL, FilePath: dest,
		Status: StatusQueued, SizeBytes: -1,
	}
	job := &Job{
		ID:     "job_retry",
		Status: StatusQueued,
		Tasks:  []*Task{task},
	}
	m.jobs[job.ID] = job

	m.executeTask(context.Background(), task)

	if attempts.Load() < 2 {
		t.Fatalf("expected at least 2 attempts, got %d", attempts.Load())
	}
	if task.Status != StatusCompleted {
		t.Fatalf("status: want %s, got %s (err=%q)", StatusCompleted, task.Status, task.Error)
	}
	got := atomic.LoadInt64(&task.DownloadedBytes)
	if got != int64(len(body)) {
		t.Errorf("DownloadedBytes after retry: want %d, got %d", len(body), got)
	}
	if sz := atomic.LoadInt64(&task.SizeBytes); sz != int64(len(body)) {
		t.Errorf("SizeBytes: want %d, got %d", len(body), sz)
	}
	on, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read dest: %v", err)
	}
	if string(on) != string(body) {
		t.Errorf("file contents mismatch")
	}
}

func TestExecuteTask_CancelBeforeStart(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "should not be downloaded")
	}))
	t.Cleanup(srv.Close)

	m := newTestManager(t)
	dest := filepath.Join(t.TempDir(), "ghost.bin")
	task := &Task{
		ID: "tsk_pre", JobID: "job_pre",
		URL: srv.URL, FilePath: dest,
		Status: StatusCancelled,
	}
	m.jobs["job_pre"] = &Job{ID: "job_pre", Status: StatusCancelled, Tasks: []*Task{task}}

	m.executeTask(context.Background(), task)

	if task.Status != StatusCancelled {
		t.Errorf("status changed to %s", task.Status)
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Errorf("dest should not exist: %v", err)
	}
}

func TestSnapshotJob_Independence(t *testing.T) {
	m := newTestManager(t)
	live := &Job{
		ID: "j1", Status: StatusQueued,
		Tasks: []*Task{{
			ID: "t1", JobID: "j1",
			Status:          StatusQueued,
			DownloadedBytes: 10,
			SizeBytes:       100,
		}},
	}
	m.jobs[live.ID] = live

	snap, err := m.Get(live.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if snap == live {
		t.Errorf("snapshot is the same pointer as live job")
	}
	if len(snap.Tasks) == 0 || snap.Tasks[0] == live.Tasks[0] {
		t.Errorf("task pointer shared with live")
	}

	live.Status = StatusRunning
	live.Tasks[0].Status = StatusRunning
	atomic.StoreInt64(&live.Tasks[0].DownloadedBytes, 55)

	if snap.Status != StatusQueued {
		t.Errorf("snapshot.Status mutated: %s", snap.Status)
	}
	if snap.Tasks[0].Status != StatusQueued {
		t.Errorf("snapshot task status mutated: %s", snap.Tasks[0].Status)
	}
	if snap.Tasks[0].DownloadedBytes != 10 {
		t.Errorf("snapshot DownloadedBytes mutated: %d", snap.Tasks[0].DownloadedBytes)
	}
}

// Regression: download client used to ignore pixiv.proxy.
func TestNewManager_HonorsProxy(t *testing.T) {
	var hits atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	}))
	t.Cleanup(proxy.Close)

	cfg := config.DownloadConfig{
		OutputDir:         t.TempDir(),
		FileTemplate:      `{{.IllustID}}{{.Ext}}`,
		FileGroupTemplate: `{{.IllustID}}_{{.Index}}{{.Ext}}`,
		MaxConcurrent:     1,
		HTTPTimeout:       2 * time.Second,
		PximgBase:         "https://i.pximg.net",
		StoreFile:         filepath.Join(t.TempDir(), "downloads.json"),
	}
	hub := inbox.NewHub(8)
	pub := NewPublisher(hub, 0)
	logger := slog.New(slog.DiscardHandler)
	m, err := NewManager(cfg, proxy.URL, logger, nil, NewStore(cfg.StoreFile), pub)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	req, _ := http.NewRequest(http.MethodGet, "http://example.invalid/somefile", nil)
	resp, err := m.state.Load().client.Do(req)
	if err != nil {
		t.Fatalf("client.Do: %v", err)
	}
	_ = resp.Body.Close()

	if hits.Load() == 0 {
		t.Errorf("proxy not used: download client made a direct connection")
	}
}

// Regression: Cancel racing an active worker used to read task fields
// (Status, Error, FilePath) from the live struct on the publish path
// after m.mu was released, while the worker concurrently mutated them.
// Clean under `go test -race` iff publisher reads run through snapshots
// taken under m.mu.
func TestExecuteTask_CancelRaceWithActiveWorker(t *testing.T) {
	// Slow-trickle handler: keep sending bytes until the client
	// context is cancelled, so Cancel fires while the worker is
	// actively inside copyWithProgress.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		f, _ := w.(http.Flusher)
		for r.Context().Err() == nil {
			if _, err := w.Write([]byte("blob")); err != nil {
				return
			}
			if f != nil {
				f.Flush()
			}
			time.Sleep(2 * time.Millisecond)
		}
	}))
	t.Cleanup(srv.Close)

	m := newTestManager(t)
	dest := filepath.Join(t.TempDir(), "race.bin")
	task := &Task{
		ID: "tsk_race", JobID: "job_race",
		URL: srv.URL, FilePath: dest,
		Status: StatusQueued, SizeBytes: -1,
	}
	job := &Job{
		ID:     "job_race",
		Status: StatusQueued,
		Tasks:  []*Task{task},
	}
	m.jobs[job.ID] = job

	done := make(chan struct{})
	go func() {
		m.executeTask(context.Background(), task)
		close(done)
	}()

	// Give the worker time to transition to StatusRunning and start
	// streaming bytes. A short sleep is fine: the goal isn't timing
	// precision, it's getting the worker into the racy window.
	time.Sleep(50 * time.Millisecond)
	if err := m.Cancel(job.ID); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("executeTask did not return after cancel")
	}

	// Verify under lock to avoid introducing the very race we're
	// guarding against in this assertion.
	m.mu.RLock()
	got := task.Status
	m.mu.RUnlock()
	if got != StatusCancelled {
		t.Errorf("task.Status after cancel: want %s, got %s", StatusCancelled, got)
	}
}

func newTerminalJob(t *testing.T, m *Manager, status Status, files ...string) *Job {
	t.Helper()
	tasks := make([]*Task, 0, len(files))
	for i, path := range files {
		tasks = append(tasks, &Task{
			ID:       "tsk_" + strconv.Itoa(i),
			JobID:    "job_term",
			FilePath: path,
			Status:   StatusCompleted,
		})
	}
	job := &Job{ID: "job_term", Status: status, Tasks: tasks}
	m.jobs[job.ID] = job
	return job
}

func TestRemove_Terminal(t *testing.T) {
	m := newTestManager(t)
	job := newTerminalJob(t, m, StatusCancelled)

	if err := m.Remove(job.ID); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	if _, err := m.Get(job.ID); err == nil {
		t.Fatalf("Get after Remove: want error, got nil")
	}
	// Persisted file should also no longer contain the job.
	loaded, err := m.store.Load()
	if err != nil {
		t.Fatalf("store.Load: %v", err)
	}
	if _, ok := loaded[job.ID]; ok {
		t.Errorf("job still present on disk after Remove")
	}
}

func TestRemove_StillRunning(t *testing.T) {
	m := newTestManager(t)
	job := &Job{ID: "job_run", Status: StatusRunning, Tasks: []*Task{{Status: StatusRunning}}}
	m.jobs[job.ID] = job

	err := m.Remove(job.ID)
	if err != ErrStillRunning {
		t.Fatalf("Remove on running: want ErrStillRunning, got %v", err)
	}
	if _, err := m.Get(job.ID); err != nil {
		t.Errorf("job should still exist after failed Remove: %v", err)
	}
}

func TestRemove_NotFound(t *testing.T) {
	m := newTestManager(t)
	if err := m.Remove("missing"); err != ErrNotFound {
		t.Fatalf("Remove missing: want ErrNotFound, got %v", err)
	}
}

// Download List is a history log: Remove drops the record and never
// touches disk, regardless of the job's terminal status.
func TestRemove_KeepsFilesOnDisk(t *testing.T) {
	m := newTestManager(t)
	path := filepath.Join(m.conf().OutputDir, "keep.bin")
	if err := os.WriteFile(path, []byte("payload"), 0o644); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	job := newTerminalJob(t, m, StatusCompleted, path)

	if err := m.Remove(job.ID); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("file should remain after Remove, got %v", err)
	}
}

func seedRemoveTerminalFixture(t *testing.T, m *Manager) {
	t.Helper()
	m.jobs["job_done"] = &Job{ID: "job_done", IllustID: 1, Status: StatusCompleted}
	m.jobs["job_fail"] = &Job{ID: "job_fail", IllustID: 2, Status: StatusFailed}
	m.jobs["job_cncl"] = &Job{ID: "job_cncl", IllustID: 3, Status: StatusCancelled}
	m.jobs["job_run"] = &Job{ID: "job_run", IllustID: 4, Status: StatusRunning}
	m.jobs["job_q"] = &Job{ID: "job_q", IllustID: 5, Status: StatusQueued}
}

func TestRemoveTerminal_NilStatusesClearsAllTerminals(t *testing.T) {
	m := newTestManager(t)
	seedRemoveTerminalFixture(t, m)

	removed, err := m.RemoveTerminal(nil)
	if err != nil {
		t.Fatalf("RemoveTerminal: %v", err)
	}
	if removed != 3 {
		t.Errorf("removed: want 3, got %d", removed)
	}
	for _, id := range []string{"job_done", "job_fail", "job_cncl"} {
		if _, err := m.Get(id); err == nil {
			t.Errorf("%s should be gone", id)
		}
	}
	for _, id := range []string{"job_run", "job_q"} {
		if _, err := m.Get(id); err != nil {
			t.Errorf("%s should remain, got %v", id, err)
		}
	}
	// persist landed: store no longer contains the deleted records.
	loaded, err := m.store.Load()
	if err != nil {
		t.Fatalf("store.Load: %v", err)
	}
	for _, id := range []string{"job_done", "job_fail", "job_cncl"} {
		if _, ok := loaded[id]; ok {
			t.Errorf("%s still present on disk after RemoveTerminal", id)
		}
	}
}

func TestRemoveTerminal_FiltersBySpecificStatus(t *testing.T) {
	m := newTestManager(t)
	seedRemoveTerminalFixture(t, m)

	removed, err := m.RemoveTerminal([]Status{StatusCompleted})
	if err != nil {
		t.Fatalf("RemoveTerminal: %v", err)
	}
	if removed != 1 {
		t.Errorf("removed: want 1, got %d", removed)
	}
	if _, err := m.Get("job_done"); err == nil {
		t.Errorf("job_done should be gone")
	}
	for _, id := range []string{"job_fail", "job_cncl", "job_run", "job_q"} {
		if _, err := m.Get(id); err != nil {
			t.Errorf("%s should remain, got %v", id, err)
		}
	}
}

func TestRemoveTerminal_RejectsNonTerminalStatus(t *testing.T) {
	m := newTestManager(t)
	seedRemoveTerminalFixture(t, m)

	removed, err := m.RemoveTerminal([]Status{StatusCompleted, StatusRunning})
	if err != ErrNonTerminalStatus {
		t.Fatalf("err: want ErrNonTerminalStatus, got %v", err)
	}
	if removed != 0 {
		t.Errorf("removed: want 0 on rejection, got %d", removed)
	}
	// Nothing was deleted on input validation failure.
	if _, err := m.Get("job_done"); err != nil {
		t.Errorf("job_done should still exist, got %v", err)
	}
}

func TestRemoveTerminal_NoMatchReturnsZero(t *testing.T) {
	m := newTestManager(t)
	m.jobs["job_run"] = &Job{ID: "job_run", Status: StatusRunning}

	removed, err := m.RemoveTerminal(nil)
	if err != nil {
		t.Fatalf("RemoveTerminal: %v", err)
	}
	if removed != 0 {
		t.Errorf("removed: want 0, got %d", removed)
	}
}

// Verify every job.deleted event in the bulk carries identical
// post-mutation counts — guards against the O(N²) Counts() regression.
func TestRemoveTerminal_PublishesEventsWithStableCounts(t *testing.T) {
	hub := inbox.NewHub(64)
	pub := NewPublisher(hub, 0)
	cfg := config.DownloadConfig{
		OutputDir:         t.TempDir(),
		FileTemplate:      `{{.IllustID}}{{.Ext}}`,
		FileGroupTemplate: `{{.IllustID}}_{{.Index}}{{.Ext}}`,
		MaxConcurrent:     1,
		HTTPTimeout:       5 * time.Second,
		Retry:             config.RetryConfig{Max: 2, InitialBackoff: 5 * time.Millisecond},
		PximgBase:         "https://i.pximg.net",
		StoreFile:         filepath.Join(t.TempDir(), "downloads.json"),
	}
	m, err := NewManager(cfg, "", slog.New(slog.DiscardHandler), nil, NewStore(cfg.StoreFile), pub)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	m.jobs["job_done"] = &Job{ID: "job_done", IllustID: 1, Status: StatusCompleted}
	m.jobs["job_fail"] = &Job{ID: "job_fail", IllustID: 2, Status: StatusFailed}
	m.jobs["job_run"] = &Job{ID: "job_run", IllustID: 3, Status: StatusRunning}

	ch, _, _, cancel := hub.Subscribe([]string{"download"}, "")
	defer cancel()

	if _, err := m.RemoveTerminal(nil); err != nil {
		t.Fatalf("RemoveTerminal: %v", err)
	}

	deadline := time.After(200 * time.Millisecond)
	var deletedActive, deletedDone []int
	for len(deletedActive) < 2 {
		select {
		case env := <-ch:
			if env.Type != "job.deleted" {
				continue
			}
			var payload struct {
				ActiveCount int `json:"active_count"`
				DoneCount   int `json:"done_count"`
			}
			if err := json.Unmarshal(env.Data, &payload); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			deletedActive = append(deletedActive, payload.ActiveCount)
			deletedDone = append(deletedDone, payload.DoneCount)
		case <-deadline:
			t.Fatalf("timed out: got %d events", len(deletedActive))
		}
	}
	for i := range deletedActive {
		if deletedActive[i] != deletedActive[0] || deletedDone[i] != deletedDone[0] {
			t.Errorf("event %d counts differ: active %d vs %d, done %d vs %d",
				i, deletedActive[i], deletedActive[0], deletedDone[i], deletedDone[0])
		}
	}
	// After the bulk delete only job_run remains → active=1, done=0.
	if deletedActive[0] != 1 || deletedDone[0] != 0 {
		t.Errorf("counts post-bulk: want active=1 done=0, got active=%d done=%d", deletedActive[0], deletedDone[0])
	}
}

// Two jobs with identical candidate paths must end up at different
// FilePaths; a third must continue past " (1)" to " (2)".
func TestResolveJobCollisionsLocked_BumpsAcrossJobs(t *testing.T) {
	m := newTestManager(t)
	base := filepath.Join(m.conf().OutputDir, "shared.bin")

	mkJob := func(id string) *Job {
		return &Job{
			ID:         id,
			IllustType: IllustTypeIllust,
			Status:     StatusQueued,
			Tasks: []*Task{
				{ID: "tsk_" + id, JobID: id, FilePath: base, Status: StatusQueued},
			},
		}
	}

	jobA, jobB, jobC := mkJob("a"), mkJob("b"), mkJob("c")

	// Submit-equivalent ordering: resolve, then register.
	m.mu.Lock()
	m.resolveJobCollisionsLocked(jobA, m.reservedPathsLocked())
	m.jobs[jobA.ID] = jobA
	m.resolveJobCollisionsLocked(jobB, m.reservedPathsLocked())
	m.jobs[jobB.ID] = jobB
	m.resolveJobCollisionsLocked(jobC, m.reservedPathsLocked())
	m.jobs[jobC.ID] = jobC
	m.mu.Unlock()

	wantA := base
	wantB := filepath.Join(m.conf().OutputDir, "shared (1).bin")
	wantC := filepath.Join(m.conf().OutputDir, "shared (2).bin")
	if jobA.Tasks[0].FilePath != wantA {
		t.Errorf("jobA: want %q, got %q", wantA, jobA.Tasks[0].FilePath)
	}
	if jobB.Tasks[0].FilePath != wantB {
		t.Errorf("jobB: want %q, got %q", wantB, jobB.Tasks[0].FilePath)
	}
	if jobC.Tasks[0].FilePath != wantC {
		t.Errorf("jobC: want %q, got %q", wantC, jobC.Tasks[0].FilePath)
	}
}

// A file already on disk under the candidate path forces the resolver
// to bump even when no other job has reserved it. Mirrors the "user
// manually dropped a file in the way" case.
func TestResolveJobCollisionsLocked_BumpsPastDiskFile(t *testing.T) {
	m := newTestManager(t)
	base := filepath.Join(m.conf().OutputDir, "external.bin")
	if err := os.WriteFile(base, []byte("seed"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	job := &Job{
		ID:         "j",
		IllustType: IllustTypeIllust,
		Status:     StatusQueued,
		Tasks: []*Task{
			{ID: "tsk", JobID: "j", FilePath: base, Status: StatusQueued},
		},
	}

	m.mu.Lock()
	m.jobs[job.ID] = job
	m.resolveJobCollisionsLocked(job, m.reservedPathsLocked())
	m.mu.Unlock()

	want := filepath.Join(m.conf().OutputDir, "external (1).bin")
	if job.Tasks[0].FilePath != want {
		t.Errorf("want %q, got %q", want, job.Tasks[0].FilePath)
	}
}

// Ugoira tasks hold the zip path during download, but the resolver
// must guarantee uniqueness of the *eventual* converted artefact
// (e.g. .webp). Verify that two ugoira jobs with the same template
// output don't collide on the final extension.
func TestResolveJobCollisionsLocked_UgoiraFinalExtension(t *testing.T) {
	m := newTestManager(t)

	jobZip := func(id, stem string) *Job {
		return &Job{
			ID:           id,
			IllustType:   IllustTypeUgoira,
			UgoiraFormat: "webp", // pinned at Submit; drives the final extension
			Status:       StatusQueued,
			Tasks: []*Task{
				{
					ID: "tsk_" + id, JobID: id,
					FilePath: filepath.Join(m.conf().OutputDir, stem+".zip"),
					Status:   StatusQueued,
				},
			},
		}
	}

	a := jobZip("a", "anim")
	b := jobZip("b", "anim")

	m.mu.Lock()
	m.resolveJobCollisionsLocked(a, m.reservedPathsLocked())
	m.jobs[a.ID] = a
	m.resolveJobCollisionsLocked(b, m.reservedPathsLocked())
	m.jobs[b.ID] = b
	m.mu.Unlock()

	// First job keeps "anim.zip" (intermediate). Second must shift its
	// stem because "anim.webp" — its eventual final — would have
	// collided with jobA's eventual final.
	if a.Tasks[0].FilePath != filepath.Join(m.conf().OutputDir, "anim.zip") {
		t.Errorf("jobA zip path: got %q", a.Tasks[0].FilePath)
	}
	if b.Tasks[0].FilePath != filepath.Join(m.conf().OutputDir, "anim (1).zip") {
		t.Errorf("jobB should bump stem: got %q", b.Tasks[0].FilePath)
	}
}

// A graceful shutdown that interrupts ugoira conversion persists the
// task as queued + WroteFile=true with the zip still at FilePath. On
// the next Start, the resolver must NOT bump it: doing so leaves the
// manager-owned zip orphaned forever. It should also reserve the
// final extension so a new submit can't take it.
func TestResolveJobCollisionsLocked_PreservesOwnedZipOnRestart(t *testing.T) {
	m := newTestManager(t)

	zipPath := filepath.Join(m.conf().OutputDir, "anim.zip")
	if err := os.WriteFile(zipPath, []byte("manager-owned zip"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	job := &Job{
		ID:           "j",
		IllustType:   IllustTypeUgoira,
		UgoiraFormat: "webp",
		Status:       StatusQueued,
		Tasks: []*Task{
			{
				ID: "tsk", JobID: "j",
				FilePath:  zipPath,
				Status:    StatusQueued,
				WroteFile: true,
			},
		},
	}

	reserved := map[string]struct{}{}
	m.mu.Lock()
	m.resolveJobCollisionsLocked(job, reserved)
	m.jobs[job.ID] = job
	m.mu.Unlock()

	if job.Tasks[0].FilePath != zipPath {
		t.Errorf("FilePath must not bump for an owned task; got %q", job.Tasks[0].FilePath)
	}
	wantFinal := filepath.Join(m.conf().OutputDir, "anim.webp")
	if _, ok := reserved[zipPath]; !ok {
		t.Errorf("zip path not reserved: %v", reserved)
	}
	if _, ok := reserved[wantFinal]; !ok {
		t.Errorf("final path %q not reserved: %v", wantFinal, reserved)
	}
}

// A user-owned (or orphaned) `.zip` on disk that matches a fresh
// ugoira submission's intermediate path must force a suffix bump, or
// the worker would overwrite it on rename and ConvertUgoira (or
// Cancel cleanup) would delete it.
func TestResolveJobCollisionsLocked_UgoiraExistingZipBumps(t *testing.T) {
	m := newTestManager(t)

	existingZip := filepath.Join(m.conf().OutputDir, "anim.zip")
	if err := os.WriteFile(existingZip, []byte("user data"), 0o644); err != nil {
		t.Fatalf("seed: %v", err)
	}

	job := &Job{
		ID:           "j",
		IllustType:   IllustTypeUgoira,
		UgoiraFormat: "webp",
		Status:       StatusQueued,
		Tasks: []*Task{
			{
				ID: "tsk", JobID: "j",
				FilePath: existingZip,
				Status:   StatusQueued,
			},
		},
	}

	m.mu.Lock()
	m.resolveJobCollisionsLocked(job, m.reservedPathsLocked())
	m.jobs[job.ID] = job
	m.mu.Unlock()

	wantZip := filepath.Join(m.conf().OutputDir, "anim (1).zip")
	if job.Tasks[0].FilePath != wantZip {
		t.Errorf("zip path: want %q, got %q", wantZip, job.Tasks[0].FilePath)
	}
	// The user's original must remain readable: cleanup is per-task,
	// and the bumped task now owns a different path.
	if _, err := os.Stat(existingZip); err != nil {
		t.Errorf("original zip must survive resolution: %v", err)
	}
}

// Transactional-job cleanup must only delete files this job's
// worker actually wrote. A task that was Cancelled or Failed before
// its worker renamed a payload onto FilePath does not own whatever
// happens to sit at that path now (e.g. a file the user or another
// process dropped there between Submit and cancel) — the WroteFile
// flag is what makes that distinction.
func TestCancel_PreservesUnownedFilesAtTaskPath(t *testing.T) {
	m := newTestManager(t)

	owned := filepath.Join(m.conf().OutputDir, "owned.bin")
	foreign := filepath.Join(m.conf().OutputDir, "foreign.bin")
	for _, p := range []string{owned, foreign} {
		if err := os.WriteFile(p, []byte("seed"), 0o644); err != nil {
			t.Fatalf("seed %s: %v", p, err)
		}
	}

	job := &Job{
		ID:     "job_mixed",
		Status: StatusRunning,
		Tasks: []*Task{
			{
				ID:        "tsk_owned",
				JobID:     "job_mixed",
				FilePath:  owned,
				Status:    StatusRunning,
				WroteFile: true,
			},
			{
				ID:        "tsk_foreign",
				JobID:     "job_mixed",
				FilePath:  foreign,
				Status:    StatusQueued,
				WroteFile: false,
			},
		},
	}
	m.jobs[job.ID] = job

	if err := m.Cancel(job.ID); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	if _, err := os.Stat(owned); !os.IsNotExist(err) {
		t.Errorf("owned file should be cleaned up, stat err=%v", err)
	}
	if _, err := os.Stat(foreign); err != nil {
		t.Errorf("foreign file at never-written task path must survive, got %v", err)
	}
}

func seedJobs(m *Manager, jobs ...*Job) {
	for _, j := range jobs {
		m.jobs[j.ID] = j
	}
}

func TestListPage_NoFilterPaginates(t *testing.T) {
	m := newTestManager(t)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range 25 {
		seedJobs(m, &Job{
			ID:        "j" + strconv.Itoa(i),
			Status:    StatusCompleted,
			CreatedAt: base.Add(time.Duration(i) * time.Minute),
			UpdatedAt: base.Add(time.Duration(i) * time.Minute),
		})
	}

	items, total, active, done := m.ListPage(ListFilter{Page: 1, PerPage: 10})
	if total != 25 {
		t.Errorf("total: want 25, got %d", total)
	}
	if active != 0 || done != 25 {
		t.Errorf("counts: want active=0 done=25, got active=%d done=%d", active, done)
	}
	if len(items) != 10 {
		t.Fatalf("page 1 len: want 10, got %d", len(items))
	}
	// Newest first: j24 should lead.
	if items[0].ID != "j24" {
		t.Errorf("page 1 head: want j24, got %s", items[0].ID)
	}

	items, _, _, _ = m.ListPage(ListFilter{Page: 3, PerPage: 10})
	if len(items) != 5 {
		t.Errorf("page 3 len: want 5, got %d", len(items))
	}
}

func TestListPage_StatusFilter(t *testing.T) {
	m := newTestManager(t)
	now := time.Now().UTC()
	seedJobs(m,
		&Job{ID: "q1", Status: StatusQueued, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "r1", Status: StatusRunning, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "c1", Status: StatusCompleted, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "f1", Status: StatusFailed, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "x1", Status: StatusCancelled, CreatedAt: now, UpdatedAt: now},
	)

	items, total, active, done := m.ListPage(ListFilter{
		Statuses: []Status{StatusQueued, StatusRunning},
		Page:     1,
		PerPage:  20,
	})
	if total != 2 || len(items) != 2 {
		t.Errorf("active filter: want total=2 len=2, got total=%d len=%d", total, len(items))
	}
	if active != 2 || done != 1 {
		t.Errorf("global counts unaffected by filter: want active=2 done=1, got active=%d done=%d", active, done)
	}
}

func TestListPage_UpdatedSinceFilter(t *testing.T) {
	m := newTestManager(t)
	now := time.Now().UTC()
	cutoff := now.Add(-30 * time.Minute)
	seedJobs(m,
		&Job{ID: "old", Status: StatusCompleted, CreatedAt: now.Add(-time.Hour), UpdatedAt: now.Add(-time.Hour)},
		&Job{ID: "edge", Status: StatusCompleted, CreatedAt: cutoff, UpdatedAt: cutoff},
		&Job{ID: "fresh", Status: StatusCompleted, CreatedAt: now, UpdatedAt: now},
	)

	items, total, _, _ := m.ListPage(ListFilter{
		UpdatedSince: cutoff,
		Page:         1,
		PerPage:      20,
	})
	if total != 2 {
		t.Fatalf("total: want 2 (edge + fresh), got %d", total)
	}
	got := map[string]bool{}
	for _, j := range items {
		got[j.ID] = true
	}
	if !got["edge"] || !got["fresh"] || got["old"] {
		t.Errorf("filter set: got %+v, want {edge, fresh}", got)
	}
}

func TestListPage_PageBeyondTotal(t *testing.T) {
	m := newTestManager(t)
	now := time.Now().UTC()
	seedJobs(m,
		&Job{ID: "a", Status: StatusCompleted, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "b", Status: StatusCompleted, CreatedAt: now, UpdatedAt: now},
	)

	items, total, _, _ := m.ListPage(ListFilter{Page: 5, PerPage: 20})
	if total != 2 {
		t.Errorf("total: want 2, got %d", total)
	}
	if len(items) != 0 {
		t.Errorf("items beyond range: want 0, got %d", len(items))
	}
}

// Regression: adversarial `page` values used to overflow (page-1)*perPage
// and slice into matched[] with a wrapped index, panicking the request.
func TestListPage_HugePageDoesNotOverflow(t *testing.T) {
	m := newTestManager(t)
	now := time.Now().UTC()
	seedJobs(m, &Job{ID: "j1", Status: StatusCompleted, CreatedAt: now, UpdatedAt: now})

	items, total, _, _ := m.ListPage(ListFilter{Page: math.MaxInt, PerPage: 100})
	if total != 1 {
		t.Errorf("total: want 1, got %d", total)
	}
	if len(items) != 0 {
		t.Errorf("items beyond range: want 0, got %d", len(items))
	}
}

func TestListPage_PerPageBoundaries(t *testing.T) {
	m := newTestManager(t)
	now := time.Now().UTC()
	for i := range 5 {
		seedJobs(m, &Job{
			ID:        "j" + strconv.Itoa(i),
			Status:    StatusCompleted,
			CreatedAt: now.Add(time.Duration(i) * time.Second),
			UpdatedAt: now,
		})
	}

	// PerPage 0 → default 20
	items, _, _, _ := m.ListPage(ListFilter{Page: 1, PerPage: 0})
	if len(items) != 5 {
		t.Errorf("PerPage 0: want all 5 (default 20), got %d", len(items))
	}
	// PerPage < 0 → default 20
	items, _, _, _ = m.ListPage(ListFilter{Page: 1, PerPage: -1})
	if len(items) != 5 {
		t.Errorf("PerPage -1: want all 5, got %d", len(items))
	}
	// Page 0 → 1
	items, _, _, _ = m.ListPage(ListFilter{Page: 0, PerPage: 2})
	if len(items) != 2 {
		t.Errorf("Page 0 (=1) with PerPage 2: want 2, got %d", len(items))
	}
}

func TestCounts(t *testing.T) {
	m := newTestManager(t)
	now := time.Now().UTC()
	seedJobs(m,
		&Job{ID: "q1", Status: StatusQueued, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "q2", Status: StatusQueued, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "r1", Status: StatusRunning, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "c1", Status: StatusCompleted, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "c2", Status: StatusCompleted, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "f1", Status: StatusFailed, CreatedAt: now, UpdatedAt: now},
		&Job{ID: "x1", Status: StatusCancelled, CreatedAt: now, UpdatedAt: now},
	)

	active, done := m.Counts()
	if active != 3 {
		t.Errorf("active: want 3 (2 queued + 1 running), got %d", active)
	}
	if done != 2 {
		t.Errorf("done: want 2 (completed only), got %d", done)
	}
}

func TestRunDownloadWithRetries_PersistsWroteFileBeforeUgoiraConvert(t *testing.T) {
	body := []byte("ugoira-zip-bytes")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)

	m := newTestManager(t)
	dest := filepath.Join(t.TempDir(), "anim.zip")
	task := &Task{
		ID: "tsk_ugo", JobID: "job_ugo",
		URL: srv.URL, FilePath: dest,
		Status: StatusRunning, SizeBytes: -1,
	}
	job := &Job{
		ID:         "job_ugo",
		IllustType: IllustTypeUgoira,
		Status:     StatusRunning,
		Tasks:      []*Task{task},
	}
	m.jobs[job.ID] = job

	ctx := context.Background()
	if err := m.runDownloadWithRetries(ctx, ctx, task, true); err != nil {
		t.Fatalf("runDownloadWithRetries: %v", err)
	}

	loaded, err := NewStore(m.conf().StoreFile).Load()
	if err != nil {
		t.Fatalf("reload store: %v", err)
	}
	got, ok := loaded[job.ID]
	if !ok || len(got.Tasks) != 1 {
		t.Fatalf("loaded job missing or shape wrong: %+v", loaded)
	}
	if !got.Tasks[0].WroteFile {
		t.Errorf("WroteFile not persisted; collision resolver would bump path on restart")
	}
	if got.Tasks[0].Status != StatusRunning {
		t.Errorf("status: want %s (ugoira branch keeps task running through convert), got %s",
			StatusRunning, got.Tasks[0].Status)
	}
}

func TestReload_SwapsRendererAndConfig(t *testing.T) {
	m := newTestManager(t)
	before := m.state.Load().renderer
	cfg := m.conf()
	cfg.FileTemplate = `{{.IllustID}}_v2{{.Ext}}`
	if err := m.Reload(cfg, ""); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if m.conf().FileTemplate != cfg.FileTemplate {
		t.Errorf("config not updated: got %q", m.conf().FileTemplate)
	}
	if m.state.Load().renderer == before {
		t.Error("renderer not rebuilt after template change")
	}
}

func TestReload_BadTemplateKeepsOldState(t *testing.T) {
	m := newTestManager(t)
	before := m.state.Load()
	cfg := m.conf()
	cfg.FileTemplate = `{{.Nope` // unterminated action: parse error
	if err := m.Reload(cfg, ""); err == nil {
		t.Fatal("expected error for malformed template")
	}
	if m.state.Load() != before {
		t.Error("state swapped despite a failed reload")
	}
}

func TestReload_MaxConcurrentPinnedToStartup(t *testing.T) {
	m := newTestManager(t)
	startup := m.conf().MaxConcurrent
	cfg := m.conf()
	cfg.MaxConcurrent = startup + 8 // restart-required: must not apply live
	if err := m.Reload(cfg, ""); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if got := m.conf().MaxConcurrent; got != startup {
		t.Errorf("max_concurrent applied live: got %d, want pinned %d", got, startup)
	}
}

// TestReload_ConcurrentWithReads stresses the atomic dlState swap against
// the hot-path readers so the race detector catches any field read that
// bypasses m.state.Load().
func TestReload_ConcurrentWithReads(t *testing.T) {
	m := newTestManager(t)
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					st := m.state.Load()
					_ = st.cfg.Referer
					_ = st.cfg.Retry.Max
					_ = st.renderer
					_ = st.client
				}
			}
		}()
	}
	for i := 0; i < 100; i++ {
		cfg := m.conf()
		cfg.Referer = "https://example.com/" + strconv.Itoa(i)
		if err := m.Reload(cfg, ""); err != nil {
			t.Fatalf("Reload: %v", err)
		}
	}
	close(stop)
	wg.Wait()
}

// Regression: hot-reloading download.ugoira.format must not change the
// conversion output path of a job that pinned its format at Submit.
func TestFinalPathLocked_UsesPinnedJobFormat(t *testing.T) {
	m := newTestManager(t)
	setUgoiraFormat(m, "gif") // live config differs from the job's pin
	job := &Job{ID: "j", IllustType: IllustTypeUgoira, UgoiraFormat: "webp"}
	task := &Task{ID: "t", JobID: "j", FilePath: filepath.Join(m.conf().OutputDir, "anim.zip"), Status: StatusQueued}

	m.mu.Lock()
	got := m.finalPathLocked(job, task)
	m.mu.Unlock()

	want := filepath.Join(m.conf().OutputDir, "anim.webp")
	if got != want {
		t.Errorf("finalPathLocked = %q, want pinned-format %q (must ignore live config)", got, want)
	}
}

// A job with no pinned format is treated as "none" (zip kept) — the live
// config must NOT leak in as a fallback.
func TestFinalPathLocked_EmptyFormatLeavesZipPath(t *testing.T) {
	m := newTestManager(t)
	setUgoiraFormat(m, "gif")                          // live config must not influence the result
	job := &Job{ID: "j", IllustType: IllustTypeUgoira} // no pinned format
	zip := filepath.Join(m.conf().OutputDir, "anim.zip")
	task := &Task{ID: "t", JobID: "j", FilePath: zip, Status: StatusQueued}

	m.mu.Lock()
	got := m.finalPathLocked(job, task)
	m.mu.Unlock()

	if got != zip {
		t.Errorf("finalPathLocked = %q, want unchanged zip %q (no live-config fallback)", got, zip)
	}
}
