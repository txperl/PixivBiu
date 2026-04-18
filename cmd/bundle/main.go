// Command bundle resolves all $refs in api/openapi.yaml (including references
// into api/paths/*.yaml) and writes a single self-contained JSON spec to
// api/openapi.bundled.json. oapi-codegen then runs against the bundled file,
// sidestepping its lack of native cross-file $ref support.
//
// Usage (via Makefile): go run ./cmd/bundle
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/getkin/kin-openapi/openapi3"
)

func main() {
	in := flag.String("in", "api/openapi.yaml", "input OpenAPI spec (root)")
	out := flag.String("out", "api/openapi.bundled.json", "output bundled spec (JSON)")
	flag.Parse()

	loader := openapi3.NewLoader()
	loader.IsExternalRefsAllowed = true

	doc, err := loader.LoadFromFile(*in)
	if err != nil {
		die("load %s: %v", *in, err)
	}

	// Rewrite every external $ref into an internal one anchored in this doc.
	doc.InternalizeRefs(context.Background(), nil)

	if err := doc.Validate(context.Background()); err != nil {
		die("validate bundled spec: %v", err)
	}

	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		die("marshal: %v", err)
	}
	if err := os.WriteFile(*out, data, 0o644); err != nil {
		die("write %s: %v", *out, err)
	}
	fmt.Printf("bundled %s -> %s (%d bytes)\n", *in, *out, len(data))
}

func die(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "bundle: "+format+"\n", args...)
	os.Exit(1)
}
