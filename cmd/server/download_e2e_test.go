package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/txperl/PixivBiu/internal/api"
	"github.com/txperl/PixivBiu/internal/config"
	"github.com/txperl/PixivBiu/internal/download"
	"github.com/txperl/PixivBiu/internal/state"
	"github.com/txperl/pixivgo"
)

// This fixture exercises the production router, config reload hooks, download
// workers, persistence and embedded SPA. Only Pixiv and its media are replaced.
// It never loads the developer's settings, session or download directory.
type downloadE2E struct {
	t         *testing.T
	root      string
	upstream  *httptest.Server
	server    *httptest.Server
	app       *app
	mediaGets atomic.Int64
	started   chan struct{}
}

func newDownloadE2E(t *testing.T) *downloadE2E {
	t.Helper()
	// File paths, proxy settings and the opt-in flag must not inherit real
	// application overrides. testing restores each variable after the test.
	schema, err := config.BuildSchema()
	if err != nil {
		t.Fatal(err)
	}
	for key := range schema.Fields {
		name := "PIXIVBIU_" + strings.ToUpper(strings.ReplaceAll(key, ".", "_"))
		t.Setenv(name, "")
		if err := os.Unsetenv(name); err != nil {
			t.Fatal(err)
		}
	}
	f := &downloadE2E{t: t, root: t.TempDir(), started: make(chan struct{}, 1)}
	if err := config.NewStore(filepath.Join(f.root, "settings.json")).Save(map[string]any{
		"app.language": "en", "app.open_browser": false, "app.update.enabled": false,
		"log.level": "error", "download.output_dir": "./files",
		"download.file_template":       "{{.IllustID}}{{.Ext}}",
		"download.file_group_template": "{{.IllustID}}/{{.Index}}{{.Ext}}",
		"download.max_concurrent":      1, "download.retry.max": 0,
	}); err != nil {
		t.Fatal(err)
	}
	if err := state.NewStore(filepath.Join(f.root, "usr", "state.json")).Save(state.Token{
		AccessToken: "synthetic-e2e-access", RefreshToken: "synthetic-e2e-refresh",
		UserID: 123, UserName: "E2E test account", AccessTokenExpiresAt: time.Now().Add(24 * time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	var pngData, zipData bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	for y := range 64 {
		for x := range 64 {
			img.Set(x, y, color.NRGBA{R: uint8(x * 4), G: uint8(y * 4), B: 120, A: 255})
		}
	}
	if err := png.Encode(&pngData, img); err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(&zipData)
	for i := range 2 {
		w, err := zw.Create(fmt.Sprintf("%d.png", i))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(pngData.Bytes()); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	f.upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/illust/detail":
			id, _ := strconv.Atoi(r.URL.Query().Get("illust_id"))
			_ = json.NewEncoder(w).Encode(map[string]any{"illust": f.illust(id)})
		case "/v1/illust/recommended":
			illusts := []any{}
			for _, id := range []int{101, 102, 103, 104} {
				illusts = append(illusts, f.illust(id))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"illusts": illusts, "next_url": nil})
		case "/v1/ugoira/metadata":
			_ = json.NewEncoder(w).Encode(map[string]any{"ugoira_metadata": map[string]any{
				"zip_urls": map[string]string{"medium": f.upstream.URL + "/media/103.zip"},
				"frames":   []any{map[string]any{"file": "0.png", "delay": 100}, map[string]any{"file": "1.png", "delay": 100}},
			}})
		case "/v2/illust/bookmark/detail":
			_, _ = io.WriteString(w, `{"bookmark_detail":{"is_bookmarked":false,"restrict":"public","tags":[]}}`)
		case "/v1/user/following":
			_, _ = io.WriteString(w, `{"user_previews":[],"next_url":null}`)
		default:
			if !strings.HasPrefix(r.URL.Path, "/media/") && r.URL.Path != "/preview.png" {
				http.Error(w, "unhandled fixture endpoint: "+r.URL.Path, http.StatusNotFound)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/media/") {
				f.mediaGets.Add(1)
			}
			if r.URL.Path == "/media/105.png" {
				f.started <- struct{}{}
				<-r.Context().Done()
				return
			}
			if r.URL.Path == "/media/104_1.png" {
				// The path was free at reservation time. An external file appears
				// before sidecar publication, which must fail without deleting it.
				path := filepath.Join(f.root, "files", "104", "2.png.json")
				if err := os.WriteFile(path, []byte(`{"external":true}`), 0o600); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
			}
			if strings.HasSuffix(r.URL.Path, ".zip") {
				w.Header().Set("Content-Type", "application/zip")
				_, _ = w.Write(zipData.Bytes())
			} else {
				w.Header().Set("Content-Type", "image/png")
				_, _ = w.Write(pngData.Bytes())
			}
		}
	}))
	t.Cleanup(f.upstream.Close)
	t.Cleanup(f.stop)
	return f
}

func (f *downloadE2E) illust(id int) map[string]any {
	urls := map[string]string{"square_medium": f.upstream.URL + "/preview.png", "medium": f.upstream.URL + "/preview.png", "large": f.upstream.URL + "/preview.png"}
	title, kind, count := "Single image — 完整标题", "illust", 1
	pages := []any{}
	if id == 102 || id == 104 {
		title, kind, count = "Multiple pages — 中文・日本語", "manga", 2
		for i := range count {
			pages = append(pages, map[string]any{"image_urls": map[string]string{
				"original": fmt.Sprintf("%s/media/%d_%d.png", f.upstream.URL, id, i),
				"large":    urls["large"], "medium": urls["medium"], "square_medium": urls["square_medium"],
			}})
		}
	}
	if id == 103 {
		title, kind = "Animation — 动图", "ugoira"
	}
	if id == 104 {
		title = "Metadata failure — 外部文件保留"
	}
	if id == 106 {
		title = strings.Repeat("中文タイトル🌸", 100)
	}
	return map[string]any{
		"id": id, "title": title, "type": kind, "page_count": count, "width": 64, "height": 64,
		"caption":    "<p>" + strings.Repeat("完整说明・説明 🌸", 200) + "</p>",
		"image_urls": urls, "meta_pages": pages,
		"meta_single_page": map[string]string{"original_image_url": fmt.Sprintf("%s/media/%d.png", f.upstream.URL, id)},
		"user":             map[string]any{"id": 123, "name": "作者・Author", "account": "e2e", "profile_image_urls": map[string]string{"medium": urls["medium"]}, "is_followed": false},
		"tags":             []any{map[string]any{"name": strings.Repeat("完整标签", 100), "translated_name": "complete tag"}},
		"tools":            []string{}, "create_date": "2026-10-16T00:00:00+00:00", "restrict": 0, "x_restrict": 0,
		"sanity_level": 2, "total_view": 10, "total_bookmarks": 2, "is_bookmarked": false,
		"visible": true, "is_muted": false, "total_comments": 0,
	}
}

func (f *downloadE2E) start(address string) {
	f.t.Helper()
	open := false
	a, err := newApp(f.root, filepath.Join(f.root, "cache"), filepath.Join(f.root, "settings.json"), &open, true)
	if err != nil {
		f.t.Fatal(err)
	}
	pixivgo.WithBaseURL(f.upstream.URL)(a.svc.Client())
	pixivgo.WithHTTPClient(f.upstream.Client())(a.svc.Client())
	a.registerReloadHooks()
	a.dlMgr.Start(context.Background())
	f.app = a
	f.server = httptest.NewUnstartedServer(a.srv.Handler)
	if address != "" {
		_ = f.server.Listener.Close()
		f.server.Listener, err = net.Listen("tcp", address)
		if err != nil {
			f.t.Fatal(err)
		}
	}
	f.server.Start()
}

func (f *downloadE2E) stop() {
	if f.server != nil {
		f.app.hub.Shutdown()
		f.server.Close()
		f.app.dlMgr.Shutdown()
		f.app.svc.Shutdown()
		f.server = nil
	}
}

func (f *downloadE2E) request(method, path string, body any, status int, result any) {
	f.t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		f.t.Fatal(err)
	}
	req, err := http.NewRequest(method, f.server.URL+"/api/v1"+path, bytes.NewReader(data))
	if err != nil {
		f.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		f.t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != status {
		message, _ := io.ReadAll(resp.Body)
		f.t.Fatalf("%s %s: status %d, want %d: %s", method, path, resp.StatusCode, status, message)
	}
	if result != nil {
		if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
			f.t.Fatal(err)
		}
	}
}

func (f *downloadE2E) submit(id int) api.DownloadJob {
	f.t.Helper()
	var job api.DownloadJob
	f.request("POST", "/downloads", map[string]int{"illust_id": id}, 202, &job)
	return job
}

func (f *downloadE2E) events() func(string, string) {
	f.t.Helper()
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(f.server.URL + "/api/v1/events?topics=download")
	if err != nil {
		f.t.Fatal(err)
	}
	f.t.Cleanup(func() { _ = resp.Body.Close() })
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "text/event-stream" {
		f.t.Fatalf("invalid SSE response: %s", resp.Status)
	}
	scanner := bufio.NewScanner(resp.Body)
	return func(jobID, eventType string) {
		f.t.Helper()
		for scanner.Scan() {
			data, ok := strings.CutPrefix(scanner.Text(), "data: ")
			if !ok {
				continue
			}
			var event struct {
				Type string `json:"type"`
				Data struct {
					JobID string `json:"job_id"`
				} `json:"data"`
			}
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				f.t.Fatal(err)
			}
			if event.Data.JobID == jobID && event.Type == eventType {
				return
			}
		}
		f.t.Fatalf("missing SSE event %s for %s: %v", eventType, jobID, scanner.Err())
	}
}

func (f *downloadE2E) finished(job api.DownloadJob, status string) api.DownloadJob {
	f.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		f.request("GET", "/downloads/"+job.Id, nil, 200, &job)
		if download.Status(job.Status).IsTerminal() {
			if string(job.Status) != status {
				f.t.Fatalf("job %s: got %s, want %s: %+v", job.Id, job.Status, status, job.Tasks)
			}
			return job
		}
		time.Sleep(10 * time.Millisecond)
	}
	f.t.Fatalf("job %s did not finish: %+v", job.Id, job)
	return job
}

func (f *downloadE2E) checkSidecars(job api.DownloadJob) {
	f.t.Helper()
	for i, task := range job.Tasks {
		data, err := os.ReadFile(task.FilePath + ".json")
		if err != nil {
			f.t.Fatal(err)
		}
		var got struct {
			SchemaVersion int                      `json:"schema_version"`
			FileName      string                   `json:"file_name"`
			PageIndex     int                      `json:"page_index"`
			JobID         string                   `json:"job_id"`
			TaskID        string                   `json:"task_id"`
			Illust        pixivgo.IllustrationInfo `json:"illust"`
			Ugoira        *pixivgo.UgoiraMetadata  `json:"ugoira"`
		}
		if err := json.Unmarshal(data, &got); err != nil {
			f.t.Fatal(err)
		}
		if got.SchemaVersion != 1 || got.FileName != filepath.Base(task.FilePath) || got.PageIndex != i || got.JobID != job.Id || got.TaskID != task.Id {
			f.t.Fatalf("incorrect sidecar identity: %s", data)
		}
		if got.Illust.Title != f.illust(int(job.IllustId))["title"] || got.Illust.Caption != f.illust(int(job.IllustId))["caption"] || got.Illust.Tags[0].Name != strings.Repeat("完整标签", 100) {
			f.t.Fatal("truncated metadata")
		}
		if job.IllustType == "ugoira" && (got.Ugoira == nil || len(got.Ugoira.Frames) != 2) {
			f.t.Fatal("missing ugoira frame metadata")
		}
		if info, err := os.Stat(task.FilePath); err != nil || info.Size() == 0 {
			f.t.Fatalf("missing media: %s (%v)", task.FilePath, err)
		}
	}
}

func TestDownloadMetadataHTTP(t *testing.T) {
	f := newDownloadE2E(t)
	f.start("")
	awaitEvent := f.events()
	off := f.finished(f.submit(101), "completed")
	if _, err := os.Stat(off.Tasks[0].FilePath + ".json"); !os.IsNotExist(err) {
		t.Fatalf("default-off download created metadata: %v", err)
	}
	var view api.ConfigView
	f.request("PATCH", "/config", map[string]any{"download.save_metadata": true}, 200, &view)
	if len(view.PendingRestart) != 0 || view.Effective["download"].(map[string]any)["save_metadata"] != true {
		t.Fatal("setting did not take effect immediately")
	}
	on := f.submit(101)
	awaitEvent(on.Id, "job.completed")
	on = f.finished(on, "completed")
	f.checkSidecars(on)
	if on.Tasks[0].FilePath == off.Tasks[0].FilePath {
		t.Fatal("repeat download overwrote prior output")
	}
	f.checkSidecars(f.finished(f.submit(102), "completed"))
	for _, format := range []string{"webp", "gif", "none"} {
		f.request("PATCH", "/config", map[string]any{"download.ugoira.format": format}, 200, nil)
		job := f.finished(f.submit(103), "completed")
		f.checkSidecars(job)
		ext := "." + format
		if format == "none" {
			ext = ".zip"
		}
		if filepath.Ext(job.Tasks[0].FilePath) != ext {
			t.Fatalf("unexpected output format: %s", job.Tasks[0].FilePath)
		}
	}
	failed := f.submit(104)
	awaitEvent(failed.Id, "job.failed")
	failed = f.finished(failed, "failed")
	if failed.Tasks[1].Error == nil || *failed.Tasks[1].Error != "metadata: unable to save metadata file" {
		t.Fatalf("unsafe or missing error: %+v", failed.Tasks[1])
	}
	for _, task := range failed.Tasks {
		if _, err := os.Stat(task.FilePath); !os.IsNotExist(err) {
			t.Fatalf("failed download retained media: %v", err)
		}
	}
	if _, err := os.Stat(failed.Tasks[0].FilePath + ".json"); !os.IsNotExist(err) {
		t.Fatalf("failed download retained sibling metadata: %v", err)
	}
	foreign, err := os.ReadFile(failed.Tasks[1].FilePath + ".json")
	if err != nil || string(foreign) != `{"external":true}` {
		t.Fatalf("foreign JSON was changed: %q (%v)", foreign, err)
	}
	// Reload the real persisted settings and download store in a fresh app.
	f.stop()
	f.start("")
	f.request("GET", "/config", nil, 200, &view)
	if view.Effective["download"].(map[string]any)["save_metadata"] != true {
		t.Fatal("setting lost after restart")
	}
	f.finished(on, "completed")
	f.request("DELETE", "/downloads?status=completed", nil, 200, nil)
	f.checkSidecars(on)
	f.request("GET", "/downloads/"+on.Id, nil, 404, nil)
	f.request("POST", "/config/reset", map[string]any{"keys": []string{"download.save_metadata"}}, 200, &view)
	if view.Effective["download"].(map[string]any)["save_metadata"] != false {
		t.Fatal("reset did not disable metadata")
	}
	reset := f.finished(f.submit(101), "completed")
	if _, err := os.Stat(reset.Tasks[0].FilePath + ".json"); !os.IsNotExist(err) {
		t.Fatal("reset setting was not consumed by downloader")
	}
}

func TestDownloadMetadataQueuedAndCancelledHTTP(t *testing.T) {
	f := newDownloadE2E(t)
	f.start("")
	f.request("PATCH", "/config", map[string]any{"download.save_metadata": true}, 200, nil)
	blocked := f.submit(105)
	select {
	case <-f.started:
	case <-time.After(10 * time.Second):
		t.Fatal("blocking media request never started")
	}
	queued := f.submit(102)
	if queued.Status != "queued" {
		t.Fatalf("expected queued job behind busy worker, got %s", queued.Status)
	}
	f.request("PATCH", "/config", map[string]any{"download.save_metadata": false}, 200, nil)
	f.request("POST", "/downloads/"+blocked.Id+"/cancel", nil, 204, nil)
	f.finished(blocked, "cancelled")
	// The worker finishes cleanup before it can execute this queued job.
	f.checkSidecars(f.finished(queued, "completed"))
	for _, path := range []string{blocked.Tasks[0].FilePath, blocked.Tasks[0].FilePath + ".json", filepath.Join(f.root, "files", ".pixivbiu-"+blocked.Tasks[0].Id+".part")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("cancel retained artifact %s: %v", path, err)
		}
	}
	newJob := f.finished(f.submit(101), "completed")
	if _, err := os.Stat(newJob.Tasks[0].FilePath + ".json"); !os.IsNotExist(err) {
		t.Fatal("new submission ignored disabled setting")
	}
}

func TestDownloadMetadataRecoveryHTTP(t *testing.T) {
	for _, sidecarPresent := range []bool{false, true} {
		t.Run(fmt.Sprint(sidecarPresent), func(t *testing.T) {
			f := newDownloadE2E(t)
			f.start("")
			f.request("PATCH", "/config", map[string]any{"download.save_metadata": true}, 200, nil)
			job := f.finished(f.submit(101), "completed")
			f.stop()
			store := download.NewStore(filepath.Join(f.root, "usr", "downloads.json"))
			jobs, err := store.Load()
			if err != nil {
				t.Fatal(err)
			}
			// Seed the durable checkpoint before metadata completion, both
			// before and after its rename. A fresh app must finish from it.
			jobs[job.Id].Status = download.StatusRunning
			task := jobs[job.Id].Tasks[0]
			task.Status, task.WroteMetadata = download.StatusRunning, false
			if !sidecarPresent {
				if err := os.Remove(task.MetadataPath); err != nil {
					t.Fatal(err)
				}
			}
			if err := store.Save(jobs); err != nil {
				t.Fatal(err)
			}
			before := f.mediaGets.Load()
			f.start("")
			recovered := f.finished(job, "completed")
			f.checkSidecars(recovered)
			if f.mediaGets.Load() != before || recovered.Tasks[0].FilePath != job.Tasks[0].FilePath {
				t.Fatal("recovery redownloaded or renamed finished media")
			}
		})
	}
}

func TestDownloadMetadataLongPathsHTTP(t *testing.T) {
	f := newDownloadE2E(t)
	f.start("")
	f.request("PATCH", "/config", map[string]any{
		"download.save_metadata": true, "download.file_template": "{{.Title}}/{{.Title}}{{.Ext}}",
	}, 200, nil)
	first := f.finished(f.submit(106), "completed")
	second := f.finished(f.submit(106), "completed")
	if first.Tasks[0].FilePath == second.Tasks[0].FilePath {
		t.Fatal("truncated names collided")
	}
	for _, job := range []api.DownloadJob{first, second} {
		f.checkSidecars(job)
		rel, err := filepath.Rel(f.root, job.Tasks[0].FilePath)
		if err != nil {
			t.Fatal(err)
		}
		for _, segment := range strings.Split(filepath.ToSlash(rel), "/") {
			if len(segment) > 240 || !utf8.ValidString(segment) {
				t.Fatalf("invalid generated segment: %q", segment)
			}
		}
	}
}

var downloadBrowserAddress = flag.String("download-browser-address", "", "serve an isolated download browser fixture (e.g. 127.0.0.1:0)")

func TestDownloadBrowserFixture(t *testing.T) {
	if *downloadBrowserAddress == "" {
		t.Skip("opt-in browser fixture; see docs/DEVELOPMENT.md")
	}
	f := newDownloadE2E(t)
	f.start(*downloadBrowserAddress)
	t.Logf("Browser fixture: %s ; data: %s ; create %s to stop", f.server.URL, f.root, filepath.Join(f.root, "stop"))
	deadline := time.NewTimer(45 * time.Minute)
	defer deadline.Stop()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-deadline.C:
			t.Fatal("browser fixture timed out")
		case <-ticker.C:
			if _, err := os.Stat(filepath.Join(f.root, "stop")); err == nil {
				return
			}
		}
	}
}
