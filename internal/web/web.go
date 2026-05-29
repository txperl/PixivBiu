// Package web embeds the built frontend SPA into the binary and serves it.
//
// The Vite build (frontend/) writes its output to ./dist (see
// frontend/vite.config.ts -> build.outDir), which go:embed pins into the
// binary at compile time. A committed dist/.gitkeep keeps a backend-only
// `go build` compiling before the frontend has ever been built; when no
// index.html is embedded the handler serves a short notice instead.
package web

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// all: includes files whose names begin with "." or "_" too, so nothing in
// a Vite build can be silently dropped from the embed. It also matches the
// committed .gitkeep, so the pattern resolves even on a frontend-less build.
//
//go:embed all:dist
var embedded embed.FS

// notBuiltHTML is served at any route when no SPA has been embedded (a
// backend-only `make build`). A real build embeds index.html, so this is
// never reached in a release artifact.
const notBuiltHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PixivBiu</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.6">
<h1>PixivBiu</h1>
<p>The frontend has not been built into this binary.</p>
<p>Run <code>make build-web</code> (or <code>cd frontend &amp;&amp; bun run build</code>),
then rebuild the server &mdash; or use <code>make dist</code> for a full build.</p>
<p>The API is available under <code>/api/v1</code>; see <code>/docs</code>.</p>
</body></html>`

// Handler serves the embedded SPA. Real files are served as-is; any unknown
// path falls back to index.html so React Router's client-side routes (e.g.
// /settings) resolve on a hard reload. Hashed assets are cached immutably.
// When no SPA is embedded (frontend-less build), every route serves the
// "not built" notice.
func Handler() http.Handler {
	// "dist" is a compile-time constant baked in by go:embed, so fs.Sub can
	// only fail if the embed itself is broken — a build bug, not a runtime
	// condition.
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic("web: embedded dist subtree missing: " + err.Error())
	}
	fileServer := http.FileServer(http.FS(sub))
	_, statErr := fs.Stat(sub, "index.html")
	hasSPA := statErr == nil

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(sub, name); err != nil {
			if !hasSPA {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				_, _ = io.WriteString(w, notBuiltHTML)
				return
			}
			// No such asset → hand the SPA entry point to the client router.
			r = r.Clone(r.Context())
			r.URL.Path = "/"
		} else if strings.HasPrefix(name, "assets/") {
			// Vite fingerprints asset filenames, so they're safe to cache hard.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		fileServer.ServeHTTP(w, r)
	})
}
