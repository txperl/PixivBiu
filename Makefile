.PHONY: help gen-backend gen-frontend dev build build-web dist test tidy fmt vet clean

BIN       := bin/pixivbiu
PKG       := ./cmd/server
OAPI_CFG  := api/cfg.yaml
OAPI_SPEC := api/openapi.yaml
WEB_DIST  := internal/web/dist

# Version stamped into the binary via -ldflags. Mirrors what GoReleaser injects
# for releases; falls back to the git description (or "dev") for local builds.
VERSION   ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS   := -s -w -X main.version=$(VERSION)

help:  ## Show this help
	@awk 'BEGIN{FS=":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

gen-backend:  ## Generate server code from the OpenAPI spec
	go tool oapi-codegen -config $(OAPI_CFG) $(OAPI_SPEC)

gen-frontend:  ## Generate frontend OpenAPI types (requires `make dev` running)
	cd frontend && bun run gen:api

dev:  ## Run the server (port pinned so the Vite proxy / gen:api stay valid; browser auto-open off — use the Vite dev server on :5173)
	PIXIVBIU_SERVER_PORT_FALLBACK=false go run $(PKG) -config ./usr/settings.json -open=false

build:  ## Build server binary (embeds the current internal/web/dist)
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o $(BIN) $(PKG)

build-web:  ## Build the frontend into the embed dir (internal/web/dist)
	cd frontend && bun install --frozen-lockfile && bun run build

dist: build-web build  ## Full self-contained build: frontend embedded into the binary

test:  ## Run tests
	go test ./...

tidy:  ## Tidy go.mod
	go mod tidy

fmt:  ## Format code
	go fmt ./...

vet:  ## Run go vet
	go vet ./...

clean:  ## Remove build artifacts (keeps the embed-dir .gitkeep)
	rm -rf bin dist
	find $(WEB_DIST) -mindepth 1 ! -name .gitkeep -delete
