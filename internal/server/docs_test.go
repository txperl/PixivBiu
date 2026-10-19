package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Raw serving must remain self-contained when the generator or spec changes:
// consumers cannot fetch the repository's api/paths files from this endpoint.
func TestOpenAPIDocumentIsSelfContained(t *testing.T) {
	response := httptest.NewRecorder()
	handleOpenAPI(response, httptest.NewRequest(http.MethodGet, "/openapi.json", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
	if got := response.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("content type = %q", got)
	}
	var doc map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc["openapi"] != "3.0.3" {
		t.Fatalf("unexpected OpenAPI version: %v", doc["openapi"])
	}
	paths, ok := doc["paths"].(map[string]any)
	if !ok || paths["/health"] == nil || paths["/illusts/{id}"] == nil {
		t.Fatal("missing generated API paths")
	}
	var walk func(any)
	refs := 0
	walk = func(value any) {
		switch value := value.(type) {
		case map[string]any:
			if ref, ok := value["$ref"].(string); ok {
				refs++
				if !strings.HasPrefix(ref, "#/") {
					t.Errorf("external reference %q", ref)
					return
				}
				var target any = doc
				for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
					key := strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")
					object, ok := target.(map[string]any)
					if !ok || object[key] == nil {
						t.Errorf("unresolved reference %q", ref)
						break
					}
					target = object[key]
				}
			}
			for _, child := range value {
				walk(child)
			}
		case []any:
			for _, child := range value {
				walk(child)
			}
		}
	}
	walk(doc)
	if refs == 0 {
		t.Fatal("expected bundled schema references")
	}
}
