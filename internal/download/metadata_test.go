package download

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/pixiv"
	"github.com/txperl/PixivBiu/internal/state"
	"github.com/txperl/pixivgo"
)

func metadataTestJob(t *testing.T, m *Manager, count int) *Job {
	t.Helper()
	metadata, err := captureMetadata(pixivgo.IllustrationInfo{
		ID: 42, Title: strings.Repeat("中文タイトル🌸", 100), Caption: "<p>Complete description</p>",
		Tags: []pixivgo.IllustrationTag{{Name: "完整标签"}}, User: pixivgo.UserInfo{ID: 123, Name: "作者"},
	}, time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	job := &Job{ID: newID("job_"), IllustID: 42, IllustType: IllustTypeIllust, Status: StatusQueued, Metadata: metadata}
	for i := range count {
		job.Tasks = append(job.Tasks, &Task{
			ID: newID("tsk_"), JobID: job.ID, Status: StatusQueued, PageIndex: i,
			FilePath: filepath.Join(m.conf().OutputDir, fmt.Sprintf("42_%d.jpg", i)),
		})
	}
	m.resolveJobCollisionsLocked(job, m.reservedPathsLocked())
	m.jobs[job.ID] = job
	return job
}

func readMetadata(t *testing.T, path string) metadataFile {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var result metadataFile
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestMetadata_MediaAndSidecarCompleteTogether(t *testing.T) {
	m := newTestManager(t)
	job := metadataTestJob(t, m, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("image bytes"))
	}))
	defer srv.Close()
	for _, task := range job.Tasks {
		task.URL = srv.URL
		m.executeTask(context.Background(), task)
		if task.Status != StatusCompleted || !task.WroteMetadata || !task.WroteFile {
			t.Fatalf("incomplete output: %+v", task)
		}
		got := readMetadata(t, task.MetadataPath)
		if got.SchemaVersion != 1 || got.SourceURL != "https://www.pixiv.net/artworks/42" || got.PageIndex != task.PageIndex || got.FileName != filepath.Base(task.FilePath) || got.JobID != job.ID || got.TaskID != task.ID {
			t.Fatalf("incorrect export: %+v", got)
		}
		var info pixivgo.IllustrationInfo
		if err := json.Unmarshal(got.Illust, &info); err != nil {
			t.Fatal(err)
		}
		if info.Title != strings.Repeat("中文タイトル🌸", 100) || info.Tags[0].Name != "完整标签" || info.Caption != "<p>Complete description</p>" {
			t.Fatal("metadata was sanitized or truncated")
		}
	}
	if job.Status != StatusCompleted {
		t.Fatalf("job status=%s", job.Status)
	}
	snap, _ := m.Get(job.ID)
	snap.Metadata.Illust[0] = '!'
	if job.Metadata.Illust[0] != '{' {
		t.Fatal("metadata snapshot shared mutable bytes")
	}
	if err := m.Remove(job.ID); err != nil {
		t.Fatal(err)
	}
	for _, task := range job.Tasks {
		if !fileExists(task.FilePath) || !fileExists(task.MetadataPath) {
			t.Fatal("history removal deleted exported files")
		}
	}
}

func TestMetadata_FailureCleansWholeJobAndPreservesForeignJSON(t *testing.T) {
	m := newTestManager(t)
	job := metadataTestJob(t, m, 2)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("image")) }))
	defer srv.Close()
	foreign := []byte(`{"external":true}`)
	if err := os.WriteFile(job.Tasks[1].MetadataPath, foreign, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, task := range job.Tasks {
		task.URL = srv.URL
		m.executeTask(context.Background(), task)
	}
	if job.Status != StatusFailed || !strings.Contains(job.Tasks[1].Error, "metadata") {
		t.Fatalf("metadata failure was not surfaced: %+v", job)
	}
	if fileExists(job.Tasks[0].MetadataPath) {
		t.Fatal("sibling sidecar was not cleaned")
	}
	for _, task := range job.Tasks {
		if fileExists(task.FilePath) {
			t.Fatal("failed job retained media")
		}
	}
	got, err := os.ReadFile(job.Tasks[1].MetadataPath)
	if err != nil || !bytes.Equal(got, foreign) {
		t.Fatal("foreign metadata was overwritten or deleted")
	}
}

func TestMetadata_CollisionsReserveMediaZipAndJSON(t *testing.T) {
	m := newTestManager(t)
	base := filepath.Join(m.conf().OutputDir, "42.webp")
	if err := os.WriteFile(base+".json", []byte("foreign"), 0o600); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 2; i++ {
		job := metadataTestJob(t, m, 1)
		job.IllustType, job.UgoiraFormat = IllustTypeUgoira, "webp"
		task := job.Tasks[0]
		task.FilePath = replaceExt(base, ".zip")
		task.MetadataPath = ""
		m.resolveJobCollisionsLocked(job, m.reservedPathsLocked())
		want := filepath.Join(m.conf().OutputDir, fmt.Sprintf("42 (%d)", i))
		if task.FilePath != want+".zip" || task.MetadataPath != want+".webp.json" {
			t.Fatalf("bad paired reservation: %+v", task)
		}
	}
}

func TestMetadata_RecoverySkipsCompletedMedia(t *testing.T) {
	for _, sidecarAlreadyWritten := range []bool{false, true} {
		t.Run(fmt.Sprint(sidecarAlreadyWritten), func(t *testing.T) {
			m := newTestManager(t)
			job := metadataTestJob(t, m, 1)
			task := job.Tasks[0]
			task.Status, job.Status = StatusRunning, StatusRunning
			task.WroteFile = true
			task.URL = "http://invalid.test/must-not-be-requested"
			if err := os.WriteFile(task.FilePath, []byte("finished image"), 0o600); err != nil {
				t.Fatal(err)
			}
			if sidecarAlreadyWritten {
				data, err := marshalMetadata(job, task)
				if err != nil {
					t.Fatal(err)
				}
				if err := writeMetadata(context.Background(), task.MetadataPath, data); err != nil {
					t.Fatal(err)
				}
				// Deliberately do not persist the ownership flag: simulate
				// a crash after the sidecar rename and before finalization.
			}
			if err := m.persist(); err != nil {
				t.Fatal(err)
			}
			recovered, err := NewManager(m.conf(), "", m.logger, nil, m.store, m.pub, "")
			if err != nil {
				t.Fatal(err)
			}
			recovered.Start(context.Background())
			defer recovered.Shutdown()
			deadline := time.Now().Add(5 * time.Second)
			for {
				got, _ := recovered.Get(job.ID)
				if got.Status.IsTerminal() {
					if got.Status != StatusCompleted || got.Tasks[0].FilePath != task.FilePath || !got.Tasks[0].WroteMetadata {
						t.Fatalf("recovery failed: %+v / %+v", got, got.Tasks[0])
					}
					if got.Tasks[0].SizeBytes != int64(len("finished image")) || got.Tasks[0].DownloadedBytes != got.Tasks[0].SizeBytes {
						t.Fatalf("recovered progress was not restored: %+v", got.Tasks[0])
					}
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("recovery did not finish")
				}
				time.Sleep(5 * time.Millisecond)
			}
			got, err := os.ReadFile(task.FilePath)
			if err != nil || string(got) != "finished image" {
				t.Fatal("recovery changed media")
			}
		})
	}
}

func TestMetadata_CancelAndShutdownAtWriteBoundary(t *testing.T) {
	for _, shutdown := range []bool{false, true} {
		t.Run(fmt.Sprint(shutdown), func(t *testing.T) {
			m := newTestManager(t)
			job := metadataTestJob(t, m, 1)
			task := job.Tasks[0]
			task.Status, job.Status, task.WroteFile = StatusRunning, StatusRunning, true
			if err := os.WriteFile(task.FilePath, []byte("image"), 0o600); err != nil {
				t.Fatal(err)
			}
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			data, _ := marshalMetadata(job, task)
			if err := writeMetadata(parent, task.MetadataPath, data); err != nil {
				t.Fatal(err)
			}
			if shutdown {
				cancel()
			} else if err := m.Cancel(job.ID); err != nil {
				t.Fatal(err)
			}
			// The writer finished but the manager has not accepted it yet.
			m.finishMetadata(parent, parent, task, nil)
			m.finalizeTask(task, job, nil)
			if shutdown {
				if task.Status != StatusQueued || !fileExists(task.FilePath) || !fileExists(task.MetadataPath) {
					t.Fatal("shutdown discarded reusable output")
				}
				m.executeTask(context.Background(), task)
				if job.Status != StatusCompleted {
					t.Fatalf("resume failed: %+v", task)
				}
			} else if task.Status != StatusCancelled || fileExists(task.FilePath) || fileExists(task.MetadataPath) {
				t.Fatal("late metadata write resurrected cancelled output")
			}
		})
	}
}

func TestMetadata_UgoiraFormatsAndConvertedRecovery(t *testing.T) {
	for _, format := range []string{"none", "gif", "webp"} {
		t.Run(format, func(t *testing.T) {
			m := newTestManager(t)
			job := metadataTestJob(t, m, 1)
			job.IllustType, job.UgoiraFormat = IllustTypeUgoira, format
			job.UgoiraFrames = frameMeta(2)
			job.Metadata.Ugoira = json.RawMessage(`{"frames":[{"file":"000000.png","delay":60},{"file":"000001.png","delay":60}]}`)
			task := job.Tasks[0]
			task.FilePath = filepath.Join(m.conf().OutputDir, "anim.zip")
			task.MetadataPath = ""
			m.resolveJobCollisionsLocked(job, map[string]struct{}{})
			zipData, err := os.ReadFile(buildTestZip(t, 2))
			if err != nil {
				t.Fatal(err)
			}
			var requests atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); _, _ = w.Write(zipData) }))
			defer srv.Close()
			task.URL = srv.URL
			m.executeTask(context.Background(), task)
			if job.Status != StatusCompleted || filepath.Ext(task.FilePath) != ugoiraFinalExt(format) {
				t.Fatalf("ugoira failed: %+v", task)
			}
			got := readMetadata(t, task.MetadataPath)
			if got.UgoiraFormat != format || !bytes.Contains(got.Ugoira, []byte("delay")) || got.FileName != filepath.Base(task.FilePath) {
				t.Fatalf("bad ugoira metadata: %+v", got)
			}
			// Resume at the persisted final-media stage, with no sidecar yet.
			if err := os.Remove(task.MetadataPath); err != nil {
				t.Fatal(err)
			}
			task.Status, task.WroteMetadata, job.Status = StatusQueued, false, StatusQueued
			m.executeTask(context.Background(), task)
			if requests.Load() != 1 || task.Status != StatusCompleted || !fileExists(task.FilePath) {
				t.Fatalf("resume redownloaded or reconverted media: %+v", task)
			}
		})
	}
}

func TestSubmit_PinsMetadataAndPreservesPageIndexes(t *testing.T) {
	m := newTestManager(t)
	var details atomic.Int32
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/illust/detail" {
			details.Add(1)
			// The middle page has no URL. Exported page indexes must retain
			// the upstream positions instead of numbering the remaining tasks.
			fmt.Fprintf(w, `{"illust":{"id":42,"type":"manga","title":"完整标题","page_count":3,"meta_pages":[{"image_urls":{"original":%q}},{"image_urls":{}},{"image_urls":{"original":%q}}]}}`, srv.URL+"/a.jpg", srv.URL+"/c.jpg")
			return
		}
		_, _ = w.Write([]byte("image"))
	}))
	defer srv.Close()
	store := state.NewStore(filepath.Join(t.TempDir(), "test-state.json"))
	if err := store.Save(state.Token{AccessToken: "test-access", RefreshToken: "test-refresh", UserID: 123}); err != nil {
		t.Fatal(err)
	}
	svc, err := pixiv.NewService(config.PixivConfig{}, slog.New(slog.DiscardHandler), store)
	if err != nil {
		t.Fatal(err)
	}
	pixivgo.WithBaseURL(srv.URL)(svc.Client())
	pixivgo.WithHTTPClient(srv.Client())(svc.Client())
	m.pixiv = svc
	m.ctx = context.Background() // bounded queue holds these four tasks
	defer m.Shutdown()
	for _, enabled := range []bool{true, false} {
		cfg := m.conf()
		cfg.SaveMetadata = enabled
		if err := m.Reload(cfg, ""); err != nil {
			t.Fatal(err)
		}
		submitted, err := m.Submit(context.Background(), 42)
		if err != nil {
			t.Fatal(err)
		}
		cfg.SaveMetadata = !enabled
		if err := m.Reload(cfg, ""); err != nil {
			t.Fatal(err)
		}
		job := m.jobs[submitted.ID]
		if len(job.Tasks) != 2 || job.Tasks[0].PageIndex != 0 || job.Tasks[1].PageIndex != 2 || (job.Metadata != nil) != enabled {
			t.Fatalf("incorrect submitted snapshot: %+v", job)
		}
		for _, task := range job.Tasks {
			m.executeTask(context.Background(), task)
			if task.Status != StatusCompleted || fileExists(task.FilePath+".json") != enabled {
				t.Fatalf("toggle changed submitted work: %+v", task)
			}
		}
	}
	if details.Load() != 2 {
		t.Fatalf("metadata caused additional API calls: %d", details.Load())
	}
}
