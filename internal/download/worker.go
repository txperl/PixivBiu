package download

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/txperl/pixivgo"
)

// progressCallback is invoked after each Copy chunk so the caller
// can mutate counters and publish throttled events. Must be cheap;
// it runs on the hot copy path.
type progressCallback func(deltaBytes int64)

// sizeCallback is invoked once as soon as response headers arrive so
// callers can surface the server-reported total (including the -1
// sentinel when Content-Length is missing) before any bytes have been
// copied. Lets progress events report a real total mid-transfer
// instead of only after completion.
type sizeCallback func(total int64)

// httpDownload performs a single-stream HTTP GET with the Pixiv
// Referer and writes the response body to destPath. On cancel via
// ctx, the partial file is removed.
//
// taskID is mixed into the temporary filename so concurrent tasks
// targeting the same destPath don't overwrite each other's partial
// data. The final rename to destPath is last-writer-wins.
//
// Responsibilities that are NOT in here (kept in the manager):
//   - Retry policy, URL rewriting, state transitions, event publishing
//
// onSize is invoked once after headers parse, before the first
// onProgress chunk. Either callback may be nil.
//
// Returns (total bytes the server claimed, actual bytes written,
// error). total is -1 when Content-Length was omitted upstream.
func httpDownload(
	ctx context.Context,
	client *http.Client,
	fullURL, referer, destPath, taskID string,
	onSize sizeCallback,
	onProgress progressCallback,
) (total, written int64, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		return 0, 0, fmt.Errorf("build request: %w", err)
	}
	if referer != "" {
		req.Header.Set("Referer", referer)
	}
	req.Header.Set("User-Agent", "PixivBiu/3.x")

	resp, err := client.Do(req)
	if err != nil {
		return 0, 0, fmt.Errorf("http get: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return 0, 0, &httpError{StatusCode: resp.StatusCode, URL: fullURL}
	}

	total = resp.ContentLength // -1 when upstream omitted the header
	if onSize != nil {
		onSize(total)
	}

	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return total, 0, fmt.Errorf("mkdir: %w", err)
	}
	tmpPath := destPath + "." + taskID + ".part"
	f, err := os.Create(tmpPath)
	if err != nil {
		return total, 0, fmt.Errorf("create file: %w", err)
	}

	written, copyErr := copyWithProgress(ctx, f, resp.Body, onProgress)
	closeErr := f.Close()

	if copyErr != nil {
		_ = os.Remove(tmpPath)
		return total, written, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		return total, written, fmt.Errorf("close file: %w", closeErr)
	}
	// os.Rename already replaces on both POSIX and Windows
	// (MoveFileExW + MOVEFILE_REPLACE_EXISTING). On failure we leave
	// tmpPath untouched — it holds the only copy of the bytes we just
	// downloaded, and a retry reuses the same deterministic path.
	if err := os.Rename(tmpPath, destPath); err != nil {
		return total, written, fmt.Errorf("rename: %w", err)
	}
	return total, written, nil
}

// copyWithProgress is io.Copy with a progress callback and ctx
// awareness. 32KiB chunks — bigger than io.Copy's default 32KiB but
// using the same buffer size for simplicity; the hot path is network
// IO, not memcpy.
func copyWithProgress(ctx context.Context, dst io.Writer, src io.Reader, onProgress progressCallback) (int64, error) {
	const bufSize = 32 * 1024
	buf := make([]byte, bufSize)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, rerr := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return total, werr
			}
			total += int64(n)
			if onProgress != nil {
				onProgress(int64(n))
			}
		}
		if rerr != nil {
			if errors.Is(rerr, io.EOF) {
				return total, nil
			}
			return total, rerr
		}
	}
}

// httpError is returned for non-2xx responses so callers can decide
// whether to retry (5xx, 429) or give up (4xx non-429).
type httpError struct {
	StatusCode int
	URL        string
}

func (e *httpError) Error() string {
	return fmt.Sprintf("http %d for %s", e.StatusCode, e.URL)
}

// isRetryable reports whether an error warrants another attempt.
// Non-retryable: ctx cancel/deadline, explicit 4xx (except 408/429),
// filesystem errors during local create. Anything else (5xx, dial
// reset, EOF mid-stream) is retried.
func isRetryable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var he *httpError
	if errors.As(err, &he) {
		switch he.StatusCode {
		case http.StatusRequestTimeout, http.StatusTooManyRequests:
			return true
		}
		if he.StatusCode >= 500 && he.StatusCode < 600 {
			return true
		}
		return false
	}
	// Network / EOF / reset-by-peer and anything not explicitly
	// identified above: retry. Local FS errors above are rare and
	// retrying them doesn't hurt.
	return true
}

// backoff returns the delay before retry `attempt` (1-based) given
// initial delay `base`. Doubles each time. A tiny deterministic
// jitter is added by the manager when sleeping.
func backoff(attempt int, base time.Duration) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	d := base
	for i := 1; i < attempt; i++ {
		d *= 2
		if d > 30*time.Second {
			return 30 * time.Second
		}
	}
	return d
}

func pickPreviewURL(u pixivgo.ImageUrls) string {
	if u.SquareMedium != "" {
		return u.SquareMedium
	}
	if u.Medium != "" {
		return u.Medium
	}
	return u.Large
}

// rewritePximg swaps the `https://i.pximg.net` prefix of rawURL with
// the configured mirror base, leaving non-pximg URLs untouched.
// Invalid URLs are returned unchanged — the HTTP client will surface
// the real error.
func rewritePximg(rawURL, mirrorBase string) string {
	if mirrorBase == "" || mirrorBase == "https://i.pximg.net" {
		return rawURL
	}
	const defaultBase = "https://i.pximg.net"
	if !strings.HasPrefix(rawURL, defaultBase) {
		return rawURL
	}
	return strings.TrimSuffix(mirrorBase, "/") + rawURL[len(defaultBase):]
}

// buildHTTPClient constructs an http.Client with the configured
// timeout and proxy. Kept here (not in manager) so tests can dial it
// directly.
func buildHTTPClient(timeout time.Duration, proxyURL string) (*http.Client, error) {
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
	return &http.Client{Timeout: timeout, Transport: tr}, nil
}
