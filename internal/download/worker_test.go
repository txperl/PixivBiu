package download

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestHttpDownload_WritesFileAndReportsProgress(t *testing.T) {
	body := []byte("hello there, little pixiv world")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Referer") != "https://app-api.pixiv.net/" {
			t.Errorf("missing Referer header")
		}
		w.Header().Set("Content-Length", "0")
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", itoa(len(body)))
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)

	dest := filepath.Join(t.TempDir(), "sub", "file.bin")
	var seen, sizeSeen int64
	total, written, err := httpDownload(
		context.Background(),
		http.DefaultClient,
		srv.URL,
		"https://app-api.pixiv.net/",
		dest,
		"tsk_test",
		func(sz int64) { atomic.StoreInt64(&sizeSeen, sz) },
		func(delta int64) { atomic.AddInt64(&seen, delta) },
	)
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if total != int64(len(body)) {
		t.Errorf("total: want %d, got %d", len(body), total)
	}
	if written != int64(len(body)) {
		t.Errorf("written: want %d, got %d", len(body), written)
	}
	if atomic.LoadInt64(&seen) != int64(len(body)) {
		t.Errorf("progress sum: want %d, got %d", len(body), seen)
	}
	if atomic.LoadInt64(&sizeSeen) != int64(len(body)) {
		t.Errorf("onSize total: want %d, got %d", len(body), sizeSeen)
	}
	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read dest: %v", err)
	}
	if string(got) != string(body) {
		t.Errorf("body mismatch")
	}
}

func TestHttpDownload_CancelRemovesPartial(t *testing.T) {
	// Never-ending handler: write forever, so ctx cancel is the only exit.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := w.(http.Flusher)
		w.WriteHeader(200)
		for i := 0; ; i++ {
			if _, err := w.Write([]byte("..........")); err != nil {
				return
			}
			flusher.Flush()
			time.Sleep(5 * time.Millisecond)
			if r.Context().Err() != nil {
				return
			}
		}
	}))
	t.Cleanup(srv.Close)

	dest := filepath.Join(t.TempDir(), "file.bin")
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	_, _, err := httpDownload(ctx, http.DefaultClient, srv.URL, "", dest, "tsk_test", nil, nil)
	if err == nil {
		t.Fatal("expected cancel error")
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Errorf("destination should not exist after cancel: %v", err)
	}
	if _, err := os.Stat(dest + ".tsk_test.part"); !os.IsNotExist(err) {
		t.Errorf(".part file should be cleaned up: %v", err)
	}
}

func TestHttpDownload_4xxNotRetryable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, "nope")
	}))
	t.Cleanup(srv.Close)

	_, _, err := httpDownload(
		context.Background(), http.DefaultClient, srv.URL, "", filepath.Join(t.TempDir(), "x"), "tsk_test", nil, nil,
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if isRetryable(err) {
		t.Errorf("404 should not be retryable")
	}
}

func TestHttpDownload_5xxIsRetryable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(srv.Close)

	_, _, err := httpDownload(
		context.Background(), http.DefaultClient, srv.URL, "", filepath.Join(t.TempDir(), "x"), "tsk_test", nil, nil,
	)
	if err == nil {
		t.Fatal("expected error")
	}
	if !isRetryable(err) {
		t.Errorf("502 should be retryable")
	}
}

// Regression: SizeBytes used to be populated only after the body
// finished copying, so progress events couldn't render a percentage
// mid-transfer. onSize must fire once, with the server's
// Content-Length, before any chunk callback.
func TestHttpDownload_OnSizeFiresBeforeFirstProgress(t *testing.T) {
	// Body big enough that copyWithProgress emits multiple chunks.
	body := make([]byte, 96*1024)
	for i := range body {
		body[i] = byte(i % 251)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", itoa(len(body)))
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)

	dest := filepath.Join(t.TempDir(), "file.bin")
	var sizeSeen, sizeCalls, chunkCallsAtFirstSize int64
	var chunkCalls int64
	_, _, err := httpDownload(
		context.Background(),
		http.DefaultClient,
		srv.URL,
		"",
		dest,
		"tsk_size",
		func(total int64) {
			atomic.AddInt64(&sizeCalls, 1)
			atomic.StoreInt64(&sizeSeen, total)
			// Snapshot how many chunks fired before onSize did.
			atomic.StoreInt64(&chunkCallsAtFirstSize, atomic.LoadInt64(&chunkCalls))
		},
		func(delta int64) {
			atomic.AddInt64(&chunkCalls, 1)
		},
	)
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if got := atomic.LoadInt64(&sizeCalls); got != 1 {
		t.Errorf("onSize calls: want 1, got %d", got)
	}
	if got := atomic.LoadInt64(&sizeSeen); got != int64(len(body)) {
		t.Errorf("onSize total: want %d, got %d", len(body), got)
	}
	if atomic.LoadInt64(&chunkCalls) < 2 {
		t.Fatalf("test body too small to exercise multi-chunk path: only %d chunks", chunkCalls)
	}
	if atomic.LoadInt64(&chunkCallsAtFirstSize) != 0 {
		t.Errorf("onSize fired after %d chunks; want before any chunk", chunkCallsAtFirstSize)
	}
}

func TestBackoff_Exponential(t *testing.T) {
	base := 100 * time.Millisecond
	a1 := backoff(1, base)
	a2 := backoff(2, base)
	a3 := backoff(3, base)
	if a1 != base {
		t.Errorf("attempt 1: want %v, got %v", base, a1)
	}
	if a2 != 2*base {
		t.Errorf("attempt 2: want %v, got %v", 2*base, a2)
	}
	if a3 != 4*base {
		t.Errorf("attempt 3: want %v, got %v", 4*base, a3)
	}
	// Cap at 30s regardless of input.
	big := backoff(20, time.Second)
	if big != 30*time.Second {
		t.Errorf("cap: want 30s, got %v", big)
	}
}

// Locks in the last-writer-wins contract at worker.go:L95-98:
// os.Rename replaces an existing destPath atomically on both POSIX
// and Windows. A future change that adds "skip if exists" or
// "rename with suffix" must update this test explicitly.
func TestHttpDownload_OverwritesExistingDestination(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "file.bin")
	oldContent := []byte("OLD CONTENT - must be replaced")
	if err := os.WriteFile(dest, oldContent, 0o644); err != nil {
		t.Fatalf("seed dest: %v", err)
	}

	newBody := []byte("NEW CONTENT - from server")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", itoa(len(newBody)))
		_, _ = w.Write(newBody)
	}))
	t.Cleanup(srv.Close)

	_, written, err := httpDownload(
		context.Background(), http.DefaultClient, srv.URL, "", dest, "tsk_over", nil, nil,
	)
	if err != nil {
		t.Fatalf("download: %v", err)
	}
	if written != int64(len(newBody)) {
		t.Errorf("written: want %d, got %d", len(newBody), written)
	}

	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read dest: %v", err)
	}
	if string(got) != string(newBody) {
		t.Errorf("dest content: want %q, got %q", newBody, got)
	}
	if _, err := os.Stat(dest + ".tsk_over.part"); !os.IsNotExist(err) {
		t.Errorf(".part file should not remain after successful rename: %v", err)
	}
}

// Locks in the taskID isolation contract at worker.go:L32-34: two
// concurrent downloads targeting the same destPath write to distinct
// .part files keyed by taskID, so neither fails with a "file busy"
// or produces interleaved bytes. Which body wins is scheduler-
// dependent (last-writer-wins) — the test only asserts (a) both
// calls return nil, (b) final content equals exactly one of the two
// bodies, (c) no .part residue.
func TestHttpDownload_ConcurrentTasksSameDestIsolatePartFiles(t *testing.T) {
	bodyA := []byte("AAAAAAAAAA")                 // 10 bytes
	bodyB := []byte("BBBBBBBBBBBBBBBBBBBBBBBBBB") // 26 bytes
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := bodyA
		if r.URL.Query().Get("who") == "b" {
			body = bodyB
		}
		w.Header().Set("Content-Length", itoa(len(body)))
		_, _ = w.Write(body)
	}))
	t.Cleanup(srv.Close)

	dest := filepath.Join(t.TempDir(), "file.bin")

	var wg sync.WaitGroup
	var errA, errB error
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _, errA = httpDownload(
			context.Background(), http.DefaultClient, srv.URL+"?who=a", "", dest, "tsk_a", nil, nil,
		)
	}()
	go func() {
		defer wg.Done()
		_, _, errB = httpDownload(
			context.Background(), http.DefaultClient, srv.URL+"?who=b", "", dest, "tsk_b", nil, nil,
		)
	}()
	wg.Wait()

	if errA != nil {
		t.Errorf("task A: %v", errA)
	}
	if errB != nil {
		t.Errorf("task B: %v", errB)
	}

	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("read dest: %v", err)
	}
	if string(got) != string(bodyA) && string(got) != string(bodyB) {
		t.Errorf("dest content mismatch: got %q (len=%d), want exactly bodyA or bodyB", got, len(got))
	}

	for _, tid := range []string{"tsk_a", "tsk_b"} {
		if _, err := os.Stat(dest + "." + tid + ".part"); !os.IsNotExist(err) {
			t.Errorf(".part file for %s should not remain: %v", tid, err)
		}
	}
}

// itoa avoids importing strconv for a single tiny conversion.
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + (i % 10))
		i /= 10
	}
	return string(buf[pos:])
}
