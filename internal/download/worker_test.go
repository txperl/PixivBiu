package download

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestRewritePximg(t *testing.T) {
	cases := []struct {
		in, mirror, want string
	}{
		{"https://i.pximg.net/img/a.jpg", "https://proxy.example.com", "https://proxy.example.com/img/a.jpg"},
		{"https://i.pximg.net/img/a.jpg", "https://proxy.example.com/", "https://proxy.example.com/img/a.jpg"},
		{"https://other.host/a.jpg", "https://proxy.example.com", "https://other.host/a.jpg"},
		{"https://i.pximg.net/a.jpg", "", "https://i.pximg.net/a.jpg"},
		{"https://i.pximg.net/a.jpg", "https://i.pximg.net", "https://i.pximg.net/a.jpg"},
	}
	for _, c := range cases {
		got := rewritePximg(c.in, c.mirror)
		if got != c.want {
			t.Errorf("rewritePximg(%q,%q) = %q, want %q", c.in, c.mirror, got, c.want)
		}
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
