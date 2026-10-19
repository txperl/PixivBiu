package server

import (
	"net/http"

	"github.com/txperl/PixivBiu/internal/api"
)

// Scalar API Reference page, loaded from jsDelivr. Points at /openapi.json
// which this same package serves from the embedded spec.
const scalarHTML = `<!doctype html>
<html>
  <head>
    <title>PixivBiu API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi.json"
      data-configuration='{"theme":"purple","layout":"modern"}'></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`

// handleOpenAPI serves the embedded spec at /openapi.json.
func handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	// The generator caches the decompressed JSON. References are bundled at
	// generation time; serving docs does not need a runtime schema loader.
	data, err := api.GetSpecJSON()
	if err != nil {
		http.Error(w, "OpenAPI document unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(data)
}

// handleDocs serves the Scalar HTML page at /docs.
func handleDocs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(scalarHTML))
}
