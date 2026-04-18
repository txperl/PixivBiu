package server

import (
	"encoding/json"
	"net/http"
	"sync"

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

var (
	specOnce sync.Once
	specJSON []byte
	specErr  error
)

// openAPISpec returns the embedded OpenAPI spec as JSON, lazily materialised.
func openAPISpec() ([]byte, error) {
	specOnce.Do(func() {
		doc, err := api.GetSwagger()
		if err != nil {
			specErr = err
			return
		}
		specJSON, specErr = json.Marshal(doc)
	})
	return specJSON, specErr
}

// handleOpenAPI serves the embedded spec at /openapi.json.
func handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	data, err := openAPISpec()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
