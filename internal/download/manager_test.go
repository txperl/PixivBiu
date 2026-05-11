package download

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
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
	resp, err := m.client.Do(req)
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

	if err := m.Remove(job.ID, false); err != nil {
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

	err := m.Remove(job.ID, false)
	if err != ErrStillRunning {
		t.Fatalf("Remove on running: want ErrStillRunning, got %v", err)
	}
	if _, err := m.Get(job.ID); err != nil {
		t.Errorf("job should still exist after failed Remove: %v", err)
	}
}

func TestRemove_NotFound(t *testing.T) {
	m := newTestManager(t)
	if err := m.Remove("missing", false); err != ErrNotFound {
		t.Fatalf("Remove missing: want ErrNotFound, got %v", err)
	}
}

func TestRemove_PurgeFilesDeletesCompletedFiles(t *testing.T) {
	m := newTestManager(t)
	path := filepath.Join(m.cfg.OutputDir, "out.bin")
	if err := os.WriteFile(path, []byte("payload"), 0o644); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	job := newTerminalJob(t, m, StatusCompleted, path)

	if err := m.Remove(job.ID, true); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("file should be gone, stat err=%v", err)
	}
}

func TestRemove_KeepsFilesByDefault(t *testing.T) {
	m := newTestManager(t)
	path := filepath.Join(m.cfg.OutputDir, "keep.bin")
	if err := os.WriteFile(path, []byte("payload"), 0o644); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	job := newTerminalJob(t, m, StatusCompleted, path)

	if err := m.Remove(job.ID, false); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("file should remain when purgeFiles=false, got %v", err)
	}
}

// Regression: zip not tracked → Remove(purgeFiles=true) leaks it.
func TestConvertUgoira_KeepZipTracksZipInExtraFiles(t *testing.T) {
	m := newTestManager(t)
	m.cfg.Ugoira.Format = string(UgoiraFormatWebP)
	m.cfg.Ugoira.KeepZip = true

	zipPath := buildTestZip(t, 2)
	task := &Task{ID: "tsk_ugo", JobID: "job_ugo", FilePath: zipPath, Status: StatusRunning}
	job := &Job{ID: "job_ugo", IllustType: IllustTypeUgoira, Status: StatusRunning, Tasks: []*Task{task}, UgoiraFrames: frameMeta(2)}
	m.jobs[job.ID] = job

	if err := m.convertUgoira(context.Background(), job, task); err != nil {
		t.Fatalf("convertUgoira: %v", err)
	}
	if task.FilePath == zipPath {
		t.Fatalf("FilePath should have been swapped to the converted file")
	}
	if len(task.ExtraFiles) != 1 || task.ExtraFiles[0] != zipPath {
		t.Errorf("ExtraFiles: want [%q], got %v", zipPath, task.ExtraFiles)
	}
	if _, err := os.Stat(zipPath); err != nil {
		t.Errorf("zip should remain when keep_zip=true: %v", err)
	}
}

func TestConvertUgoira_KeepZipFalseLeavesExtraFilesEmpty(t *testing.T) {
	m := newTestManager(t)
	m.cfg.Ugoira.Format = string(UgoiraFormatWebP)
	m.cfg.Ugoira.KeepZip = false

	zipPath := buildTestZip(t, 2)
	task := &Task{ID: "tsk_ugo", JobID: "job_ugo", FilePath: zipPath, Status: StatusRunning}
	job := &Job{ID: "job_ugo", IllustType: IllustTypeUgoira, Status: StatusRunning, Tasks: []*Task{task}, UgoiraFrames: frameMeta(2)}
	m.jobs[job.ID] = job

	if err := m.convertUgoira(context.Background(), job, task); err != nil {
		t.Fatalf("convertUgoira: %v", err)
	}
	if len(task.ExtraFiles) != 0 {
		t.Errorf("ExtraFiles should be empty when keep_zip=false, got %v", task.ExtraFiles)
	}
}

// Regression: keep_zip=true keeps two artefacts; purge must hit both.
func TestRemove_PurgeIncludesExtraFiles(t *testing.T) {
	m := newTestManager(t)
	converted := filepath.Join(m.cfg.OutputDir, "anim.webp")
	zip := filepath.Join(m.cfg.OutputDir, "anim.zip")
	for _, p := range []string{converted, zip} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatalf("seed %s: %v", p, err)
		}
	}
	job := &Job{
		ID:     "job_ugo",
		Status: StatusCompleted,
		Tasks: []*Task{{
			ID:         "tsk_ugo",
			JobID:      "job_ugo",
			FilePath:   converted,
			ExtraFiles: []string{zip},
			Status:     StatusCompleted,
		}},
	}
	m.jobs[job.ID] = job

	if err := m.Remove(job.ID, true); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	for _, p := range []string{converted, zip} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s should be gone, stat err=%v", p, err)
		}
	}
}

// Regression: non-completed task's FilePath may belong to an earlier
// job for the same illust — purge must skip it regardless of IllustType.
func TestRemove_PurgeKeepsFilePathForNonCompletedTask(t *testing.T) {
	for _, illustType := range []IllustType{IllustTypeIllust, IllustTypeUgoira} {
		for _, status := range []Status{StatusFailed, StatusCancelled} {
			t.Run(string(illustType)+"/"+string(status), func(t *testing.T) {
				m := newTestManager(t)
				path := filepath.Join(m.cfg.OutputDir, "12345.bin")
				if err := os.WriteFile(path, []byte("from an earlier job"), 0o644); err != nil {
					t.Fatalf("seed: %v", err)
				}
				job := &Job{
					ID:         "job_term",
					IllustType: illustType,
					Status:     status,
					Tasks: []*Task{{
						ID:       "tsk_term",
						JobID:    "job_term",
						FilePath: path,
						Status:   status,
					}},
				}
				m.jobs[job.ID] = job

				if err := m.Remove(job.ID, true); err != nil {
					t.Fatalf("Remove: %v", err)
				}
				if _, err := os.Stat(path); err != nil {
					t.Errorf("pre-existing file must not be purged: %v", err)
				}
			})
		}
	}
}

func TestRemove_PurgeSkipsMissingFile(t *testing.T) {
	m := newTestManager(t)
	job := newTerminalJob(t, m, StatusCompleted, filepath.Join(m.cfg.OutputDir, "never-existed.bin"))

	if err := m.Remove(job.ID, true); err != nil {
		t.Errorf("Remove should not fail when file is already gone: %v", err)
	}
	if _, err := m.Get(job.ID); err == nil {
		t.Errorf("job should be gone after Remove")
	}
}
