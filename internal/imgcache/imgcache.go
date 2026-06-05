// Package imgcache fetches Pixiv CDN images (i.pximg.net) with the Pixiv
// Referer, caches them on disk, and streams them back. It exists so the
// frontend can load images same-origin (no third-party mirror) with a
// persistent local cache, replacing the client-side i.pixiv.cat bridge.
package imgcache

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/txperl/PixivBiu/internal/atomicfile"
)

// AllowedHost is the only upstream host the proxy will fetch from. Pinning
// it turns the endpoint from an open proxy into a narrow Pixiv-image relay
// (SSRF guard): a caller can't make the server fetch arbitrary URLs.
const AllowedHost = "i.pximg.net"

// userAgent matches the download worker so upstream sees one client.
const userAgent = "PixivBiu/3.x"

// maxImageBytes caps a single fetched image so a malicious or broken
// upstream can't OOM the process by streaming forever. Real Pixiv images
// are well under this. A var (not const) so tests can lower it.
var maxImageBytes int64 = 64 << 20 // 64 MiB

// ErrInvalidURL is returned for a url that fails the host allowlist; the api
// package maps it to a 400 bad_request.
var ErrInvalidURL = errors.New("imgcache: invalid image url")

// UpstreamError is returned when the i.pximg.net fetch fails. Status is the
// upstream HTTP status, or 0 when no response arrived (transport failure).
// The api package maps it to a kind=upstream 502 envelope — the same
// discriminator pixiv upstream failures use. The wrapped cause is for logs
// only and never reaches the client.
type UpstreamError struct {
	Status int
	err    error
}

func (e *UpstreamError) Error() string {
	if e.Status != 0 {
		return fmt.Sprintf("imgcache: upstream status %d", e.Status)
	}
	return fmt.Sprintf("imgcache: upstream fetch failed: %v", e.err)
}

func (e *UpstreamError) Unwrap() error { return e.err }

// Proxy fetches and caches Pixiv images. The HTTP client is swapped under a
// lock on Reload so a live change to pixiv.proxy / download.http_timeout
// takes effect without disturbing in-flight requests (they keep the old
// client). Safe for concurrent use.
type Proxy struct {
	cache   *cache
	referer string

	mu       sync.RWMutex
	client   *http.Client
	proxyURL string        // last-applied, so Reload can skip an unchanged rebuild
	timeout  time.Duration // last-applied

	// group coalesces concurrent misses for the same cache key, so the upstream
	// is fetched — and the cache size accounted — exactly once per burst.
	group singleflight.Group
}

// Start launches the background cache manager, which reconciles the on-disk
// cache against the size cap until ctx is cancelled. Call once after NewProxy
// (wired in cmd/server/main.go alongside the other services' Start).
func (p *Proxy) Start(ctx context.Context) {
	go p.cache.run(ctx)
}

// NewProxy builds the disk cache (creating dir) and the initial HTTP
// client. maxBytes ≤ 0 disables eviction (unbounded cache).
func NewProxy(dir string, maxBytes int64, referer, proxyURL string, timeout time.Duration) (*Proxy, error) {
	c, err := newCache(dir, maxBytes)
	if err != nil {
		return nil, err
	}
	client, err := buildClient(proxyURL, timeout)
	if err != nil {
		return nil, err
	}
	return &Proxy{cache: c, referer: referer, client: client, proxyURL: proxyURL, timeout: timeout}, nil
}

// Reload updates the cache size ceiling and, only when proxy/timeout actually
// changed, rebuilds the HTTP client. Skipping the rebuild on an unrelated
// config save keeps the warm idle-connection pool alive (matching the
// download/pixiv/update reload pattern, which all diff before rebuilding).
// Called from the config OnReload hook.
func (p *Proxy) Reload(maxBytes int64, proxyURL string, timeout time.Duration) error {
	p.cache.setMax(maxBytes)

	p.mu.RLock()
	unchanged := proxyURL == p.proxyURL && timeout == p.timeout
	p.mu.RUnlock()
	if unchanged {
		return nil
	}
	client, err := buildClient(proxyURL, timeout)
	if err != nil {
		return err
	}
	p.mu.Lock()
	p.client = client
	p.proxyURL = proxyURL
	p.timeout = timeout
	p.mu.Unlock()
	return nil
}

func (p *Proxy) currentClient() *http.Client {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.client
}

// FetchTimeout reports the upstream fetch timeout so the HTTP handler can widen
// its response write deadline to cover a slow cache-miss fetch.
func (p *Proxy) FetchTimeout() time.Duration {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.timeout <= 0 {
		return 60 * time.Second
	}
	return p.timeout
}

// Serve resolves rawURL from the cache or fetches it upstream, writing the
// image bytes to w. The caller must have already validated the URL host. On
// a cache miss it stores the bytes (best-effort) before streaming them back.
// An error is returned only before any 200 body is written, so the caller
// can still emit an error envelope; a mid-stream failure just truncates.
func (p *Proxy) Serve(w http.ResponseWriter, r *http.Request, rawURL string) error {
	name := cacheName(rawURL)
	cachePath := filepath.Join(p.cache.dir, name)

	// Cache hit: ServeContent gives us Range + If-Modified-Since for free,
	// and infers Content-Type from the filename extension.
	if f, err := os.Open(cachePath); err == nil {
		defer f.Close()
		if st, err := f.Stat(); err == nil && !st.IsDir() {
			setImmutable(w)
			http.ServeContent(w, r, name, st.ModTime(), f)
			p.cache.touch(cachePath, st.ModTime())
			return nil
		}
		// stat failed / unexpected dir — fall through and refetch.
	}

	// Miss: coalesce concurrent fetches of the same key so the upstream is hit
	// once and the cache size is accounted once. Without this, duplicate writers
	// each add the same bytes while only one file survives on disk, inflating
	// the in-memory total and causing later over-eviction.
	v, err, _ := p.group.Do(name, func() (any, error) {
		return p.fetchAndStore(rawURL, cachePath)
	})
	if err != nil {
		return err
	}
	res := v.(*stored)

	// Pass the upstream Content-Type through on first fetch; ServeContent only
	// sniffs/derives one when the header is still empty.
	if res.contentType != "" {
		w.Header().Set("Content-Type", res.contentType)
	}
	setImmutable(w)
	http.ServeContent(w, r, name, res.modTime, bytes.NewReader(res.data))
	return nil
}

// stored is the coalesced result of one upstream fetch+store, shared by every
// caller that joined the same singleflight group.
type stored struct {
	data        []byte
	contentType string
	modTime     time.Time
}

// fetchAndStore fetches rawURL, caches it (accounting the bytes once), and
// returns what to serve. It runs inside the singleflight group and uses a
// detached context (bounded by the client's Timeout) rather than any single
// request's, so one requester disconnecting doesn't abort a fill the others
// are waiting on.
func (p *Proxy) fetchAndStore(rawURL, cachePath string) (*stored, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, &UpstreamError{err: err}
	}
	if p.referer != "" {
		req.Header.Set("Referer", p.referer)
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := p.currentClient().Do(req)
	if err != nil {
		return nil, &UpstreamError{err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &UpstreamError{Status: resp.StatusCode}
	}
	if resp.ContentLength > maxImageBytes {
		return nil, &UpstreamError{err: fmt.Errorf("image too large: %d bytes (cap %d)", resp.ContentLength, maxImageBytes)}
	}

	// Read one byte past the cap so a missing or under-reported Content-Length
	// that actually overruns is rejected, not silently cached truncated.
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes+1))
	if err != nil {
		return nil, &UpstreamError{err: err}
	}
	if int64(len(data)) > maxImageBytes {
		return nil, &UpstreamError{err: fmt.Errorf("image exceeds cap of %d bytes", maxImageBytes)}
	}

	// Persist best-effort; a cache-write failure must not fail the response.
	// notify() asks the background manager to reconcile the cap — the cache
	// itself keeps no byte total, so there's nothing to (mis)account here.
	if err := atomicfile.Write(cachePath, data); err == nil {
		p.cache.notify()
	}
	return &stored{data: data, contentType: resp.Header.Get("Content-Type"), modTime: time.Now()}, nil
}

// cacheName is the on-disk filename for rawURL: sha256(url) plus the URL's
// extension, so ServeContent can infer Content-Type on later cache hits.
func cacheName(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	name := hex.EncodeToString(sum[:])
	if u, err := url.Parse(rawURL); err == nil {
		// A pixiv path yields ".jpg"/".png"/".gif"/".webp"; bound the
		// length so a crafted url can't smuggle a long/odd suffix.
		if e := path.Ext(u.Path); len(e) >= 2 && len(e) <= 6 {
			name += e
		}
	}
	return name
}

func setImmutable(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
}

// buildClient mirrors download/worker.go::buildHTTPClient (kept local so
// this package doesn't depend on download's unexported helpers).
func buildClient(proxyURL string, timeout time.Duration) (*http.Client, error) {
	tr := &http.Transport{
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        16,
		MaxIdleConnsPerHost: 4,
	}
	if proxyURL != "" {
		u, err := url.Parse(proxyURL)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy URL: %w", err)
		}
		tr.Proxy = http.ProxyURL(u)
	}
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: tr,
		// Keep the SSRF guard effective across redirects: the handler validates
		// only the original url, so without this an i.pximg.net 3xx could send
		// the fetch to any host. Only follow a redirect that stays on the
		// allowed host; setting CheckRedirect drops Go's default 10-hop cap, so
		// re-impose it.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.URL.Scheme != "https" || req.URL.Hostname() != AllowedHost {
				return fmt.Errorf("imgcache: refusing redirect to %q", req.URL.Host)
			}
			if len(via) >= 10 {
				return errors.New("imgcache: too many redirects")
			}
			return nil
		},
	}, nil
}
