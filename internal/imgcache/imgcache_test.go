package imgcache

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// dirSize sums the bytes of every regular file in dir — the on-disk truth the
// sweeper reconciles against (the cache keeps no in-memory total).
func dirSize(t *testing.T, dir string) int64 {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir(%q): %v", dir, err)
	}
	var total int64
	for _, e := range entries {
		if info, err := e.Info(); err == nil {
			total += info.Size()
		}
	}
	return total
}

const testReferer = "https://app-api.pixiv.net/"

// TestServeMissThenHit covers the core path: a miss fetches upstream (with
// the Pixiv Referer), persists to disk, and streams back with the immutable
// header + upstream Content-Type; the next request is served from disk
// without touching upstream, still typed from the filename extension.
func TestServeMissThenHit(t *testing.T) {
	var hits int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		if got := r.Header.Get("Referer"); got != testReferer {
			t.Errorf("Referer = %q, want %q", got, testReferer)
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("PNGDATA"))
	}))
	defer upstream.Close()

	dir := t.TempDir()
	p, err := NewProxy(dir, 0, testReferer, "", time.Second)
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}
	imgURL := upstream.URL + "/img/12345_p0.png"
	req := httptest.NewRequest(http.MethodGet, "/proxy/img?url="+imgURL, nil)

	// Miss.
	rec := httptest.NewRecorder()
	if err := p.Serve(rec, req, imgURL); err != nil {
		t.Fatalf("Serve (miss): %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("miss status = %d, want 200", rec.Code)
	}
	if got := rec.Body.String(); got != "PNGDATA" {
		t.Fatalf("miss body = %q, want PNGDATA", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("Content-Type = %q, want image/png", got)
	}

	// Exactly one cached file on disk.
	files, _ := os.ReadDir(dir)
	if len(files) != 1 {
		t.Fatalf("cache files = %d, want 1", len(files))
	}

	// Hit: same bytes, no second upstream request.
	rec2 := httptest.NewRecorder()
	if err := p.Serve(rec2, req, imgURL); err != nil {
		t.Fatalf("Serve (hit): %v", err)
	}
	if got := rec2.Body.String(); got != "PNGDATA" {
		t.Fatalf("hit body = %q, want PNGDATA", got)
	}
	if got := rec2.Header().Get("Content-Type"); got != "image/png" {
		t.Errorf("hit Content-Type = %q, want image/png (inferred from .png)", got)
	}
	if n := atomic.LoadInt32(&hits); n != 1 {
		t.Errorf("upstream hits = %d, want 1 (second served from cache)", n)
	}
}

// TestServeUpstreamError surfaces a non-2xx upstream as *UpstreamError
// carrying the status, so the api layer can return a kind=upstream 502.
func TestServeUpstreamError(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()

	p, err := NewProxy(t.TempDir(), 0, "", "", time.Second)
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}
	imgURL := upstream.URL + "/x.jpg"
	rec := httptest.NewRecorder()
	err = p.Serve(rec, httptest.NewRequest(http.MethodGet, "/", nil), imgURL)
	var ue *UpstreamError
	if !errors.As(err, &ue) {
		t.Fatalf("err = %v, want *UpstreamError", err)
	}
	if ue.Status != http.StatusInternalServerError {
		t.Errorf("Status = %d, want 500", ue.Status)
	}
}

// TestServeRejectsOversized verifies an upstream body over maxImageBytes is
// rejected as an upstream error and not cached truncated.
func TestServeRejectsOversized(t *testing.T) {
	orig := maxImageBytes
	maxImageBytes = 8
	defer func() { maxImageBytes = orig }()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("way more than eight bytes"))
	}))
	defer upstream.Close()

	dir := t.TempDir()
	p, err := NewProxy(dir, 0, "", "", time.Second)
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}
	imgURL := upstream.URL + "/big.jpg"
	rec := httptest.NewRecorder()
	err = p.Serve(rec, httptest.NewRequest(http.MethodGet, "/", nil), imgURL)
	var ue *UpstreamError
	if !errors.As(err, &ue) {
		t.Fatalf("err = %v, want *UpstreamError for oversized body", err)
	}
	if files, _ := os.ReadDir(dir); len(files) != 0 {
		t.Errorf("cached %d files, want 0 (oversized must not be cached)", len(files))
	}
}

// TestSweepEvictsOverCap checks a sweep reconciles an over-cap directory back
// under the cap (down to the low-water mark).
func TestSweepEvictsOverCap(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(make([]byte, 100)) // 100-byte "images"
	}))
	defer upstream.Close()

	// Cap 250 → low-water 225. Five 100-byte writes (=500) get trimmed to ≤225.
	p, err := NewProxy(t.TempDir(), 250, "", "", time.Second)
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}
	for i := range 5 {
		imgURL := fmt.Sprintf("%s/img%d.jpg", upstream.URL, i)
		rec := httptest.NewRecorder()
		if err := p.Serve(rec, httptest.NewRequest(http.MethodGet, "/", nil), imgURL); err != nil {
			t.Fatalf("Serve %d: %v", i, err)
		}
	}

	p.cache.sweep()

	if got := dirSize(t, p.cache.dir); got > 250 {
		t.Errorf("on-disk cache = %d after sweep, want ≤ cap 250", got)
	}
}

// TestServeRejectsCrossHostRedirect is the redirect-SSRF guard: a 3xx from the
// fetched host must not be followed to a different host, even though the
// handler only validated the original url.
func TestServeRejectsCrossHostRedirect(t *testing.T) {
	var hitSecond int32
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hitSecond, 1)
		_, _ = w.Write([]byte("SECRET"))
	}))
	defer second.Close()
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, second.URL+"/leak.jpg", http.StatusFound)
	}))
	defer first.Close()

	p, err := NewProxy(t.TempDir(), 0, "", "", time.Second)
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}
	rec := httptest.NewRecorder()
	err = p.Serve(rec, httptest.NewRequest(http.MethodGet, "/", nil), first.URL+"/x.jpg")
	var ue *UpstreamError
	if !errors.As(err, &ue) {
		t.Fatalf("err = %v, want *UpstreamError (cross-host redirect blocked)", err)
	}
	if n := atomic.LoadInt32(&hitSecond); n != 0 {
		t.Errorf("followed redirect to a different host (%d hits) — SSRF guard bypassed", n)
	}
}

// TestSweepUnderConcurrentMisses verifies a sweep restores the cap after many
// concurrent distinct misses. The reconcile reads live disk truth, so nothing
// about the concurrency can corrupt it (the class of bugs the old in-memory
// counter kept hitting).
func TestSweepUnderConcurrentMisses(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(make([]byte, 100)) // 100-byte "images"
	}))
	defer upstream.Close()

	const cap = 500 // ~5 files; 50 distinct misses must not leave it over cap
	p, err := NewProxy(t.TempDir(), cap, "", "", 5*time.Second)
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}
	var wg sync.WaitGroup
	for i := range 50 {
		wg.Go(func() {
			imgURL := fmt.Sprintf("%s/img%d.jpg", upstream.URL, i)
			rec := httptest.NewRecorder()
			_ = p.Serve(rec, httptest.NewRequest(http.MethodGet, "/", nil), imgURL)
		})
	}
	wg.Wait()

	p.cache.sweep()
	if got := dirSize(t, p.cache.dir); got > cap {
		t.Errorf("on-disk cache = %d after sweep, want ≤ cap %d", got, cap)
	}
}

// TestServeCoalescesConcurrentMisses verifies concurrent misses for the SAME
// url hit the upstream once and write one file (stampede control via
// singleflight).
func TestServeCoalescesConcurrentMisses(t *testing.T) {
	var hits int32
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&hits, 1)
		<-release // hold the in-flight fetch so the others coalesce onto it
		_, _ = w.Write(make([]byte, 100))
	}))
	defer upstream.Close()

	p, err := NewProxy(t.TempDir(), 0, "", "", 5*time.Second)
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}
	imgURL := upstream.URL + "/same.jpg"
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			rec := httptest.NewRecorder()
			_ = p.Serve(rec, httptest.NewRequest(http.MethodGet, "/", nil), imgURL)
		})
	}
	time.Sleep(100 * time.Millisecond) // let all 10 join the singleflight group
	close(release)
	wg.Wait()

	if n := atomic.LoadInt32(&hits); n != 1 {
		t.Errorf("upstream hits = %d, want 1 (concurrent same-url misses must coalesce)", n)
	}
	if got := dirSize(t, p.cache.dir); got != 100 {
		t.Errorf("on-disk cache = %d, want 100 (one file, one fetch)", got)
	}
}

// TestSweepTrimsExistingOverCap covers an already-over-cap cache at startup
// (limit lowered, or a prior oversized run): the manager's boot sweep trims it
// even though those files were never seen by this process's writes.
func TestSweepTrimsExistingOverCap(t *testing.T) {
	dir := t.TempDir()
	for i := range 5 {
		name := filepath.Join(dir, fmt.Sprintf("f%d.jpg", i))
		if err := os.WriteFile(name, make([]byte, 100), 0o600); err != nil {
			t.Fatalf("seed file: %v", err)
		}
	}
	c, err := newCache(dir, 250) // cap below the existing 500 bytes
	if err != nil {
		t.Fatalf("newCache: %v", err)
	}
	c.sweep() // what run() does first on boot
	if got := dirSize(t, dir); got > 250 {
		t.Errorf("on-disk cache = %d after boot sweep, want ≤ cap 250", got)
	}
}

// TestManagerStart proves the background-manager wiring: Start launches the
// reconcile loop and a write-kick drives eviction without an explicit sweep().
func TestManagerStart(t *testing.T) {
	prev := sweepInterval
	sweepInterval = 20 * time.Millisecond // shrink the backstop tick for the test
	defer func() { sweepInterval = prev }()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(make([]byte, 100))
	}))
	defer upstream.Close()

	const cap = 300
	p, err := NewProxy(t.TempDir(), cap, "", "", 5*time.Second)
	if err != nil {
		t.Fatalf("NewProxy: %v", err)
	}
	p.Start(t.Context()) // cancelled when the test ends, stopping the manager

	for i := range 8 { // 800 bytes » cap
		imgURL := fmt.Sprintf("%s/img%d.jpg", upstream.URL, i)
		rec := httptest.NewRecorder()
		_ = p.Serve(rec, httptest.NewRequest(http.MethodGet, "/", nil), imgURL)
	}

	// The manager (write-kick + tiny ticker) should bring it under cap shortly.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if dirSize(t, p.cache.dir) <= cap {
			return // success
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Errorf("cache still over cap %d after manager ran: %d bytes", cap, dirSize(t, p.cache.dir))
}
