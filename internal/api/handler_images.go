package api

import (
	"net/http"
	"net/url"
	"time"

	"github.com/txperl/PixivBiu/internal/imgcache"
)

// imageStreamGrace pads the widened write deadline beyond the upstream fetch
// timeout to cover streaming the fetched image back to the client.
const imageStreamGrace = 30 * time.Second

// ProxyImage relays an i.pximg.net image through the same-origin backend,
// caching it on disk. The url query parameter must be an https i.pximg.net
// URL; any other host/scheme is rejected (SSRF guard) before a fetch is
// attempted. The endpoint is intentionally open (no requireAuth): it only
// proxies public Pixiv image-CDN URLs and the server binds 127.0.0.1 by
// default. The frontend points its pximg URLs here (replacing the old
// i.pixiv.cat bridge).
func (h *APIHandler) ProxyImage(w http.ResponseWriter, r *http.Request, params ProxyImageParams) {
	u, err := url.Parse(params.Url)
	if err != nil || u.Scheme != "https" || u.Hostname() != imgcache.AllowedHost {
		WriteError(w, r, imgcache.ErrInvalidURL)
		return
	}
	// A cache miss can spend up to the upstream fetch timeout (download.http_timeout,
	// 60s default) before any bytes are written — longer than the server's 15s
	// write deadline, which would otherwise drop the eventual image/error. Widen
	// it to cover the fetch plus streaming, mirroring the update handlers and the
	// SSE opt-out (internal/inbox/sse.go).
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(h.img.FetchTimeout() + imageStreamGrace))
	// Serve only returns an error before writing the 200 body, so the error
	// envelope can't land mid-stream.
	if err := h.img.Serve(w, r, params.Url); err != nil {
		WriteError(w, r, err)
	}
}
