.PHONY: help gen-backend gen-frontend dev build build-web dist test tidy fmt vet vuln clean desktop-stage desktop-dev desktop-dist desktop-fetch-core

# Windows `go build` emits a .exe; keep BIN in sync so `make build` and the
# `make desktop-*` targets (which stage / spawn the core) resolve the same name
# the Electron shell looks for (pixivbiu.exe on Windows).
EXE       := $(if $(filter Windows_NT,$(OS)),.exe,)
BIN       := bin/pixivbiu$(EXE)
PKG       := ./cmd/server
OAPI_CFG  := api/cfg.yaml
OAPI_SPEC := api/openapi.yaml
WEB_DIST  := internal/web/dist
DESKTOP   := desktop

# Version stamped into the binary via -ldflags. Mirrors what GoReleaser injects
# for releases; falls back to the git description (or "dev") for local builds.
VERSION   ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS   := -s -w -X main.version=$(VERSION)

# Optional self-updater trust anchor, mirroring the GoReleaser stamping (unset →
# no keys → the updater verifies downloads by HTTPS + SHA-256 only, without
# enforcing the checksums signature). Test the signed path with:
#   UPDATE_PUBLIC_KEYS=… make build
ifdef UPDATE_PUBLIC_KEYS
# Normalize the trusted-key list to a single -X-safe token (see release.yml for why).
UPDATE_PUBLIC_KEYS_NORM := $(shell printf '%s' '$(UPDATE_PUBLIC_KEYS)' | tr -s '[:space:],' ',' | sed 's/^,//;s/,$$//')
LDFLAGS   += -X main.updateTrustedKeysRaw=$(UPDATE_PUBLIC_KEYS_NORM)
endif

# electron-builder's arch dir name (x64 / arm64) for the host, matching
# resources/${arch}/ in desktop/electron-builder.yml. Used to stage the core into
# the host arch's dir and to pass `--$(HOST_ARCH)` to electron-builder so the local
# `make desktop-dist` packages only the host arch (electron-builder.yml lists both
# x64 and arm64 for macOS, but we only staged the one host core).
HOST_ARCH := $(shell uname -m | sed -e 's/^x86_64$$/x64/' -e 's/^amd64$$/x64/' -e 's/^aarch64$$/arm64/')

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

desktop-stage: dist  ## Stage the freshly built core binary into desktop/resources/<host-arch> for packaging
	mkdir -p $(DESKTOP)/resources/$(HOST_ARCH)
	cp $(BIN) $(DESKTOP)/resources/$(HOST_ARCH)/

desktop-dev: dist  ## Run the Electron shell against the freshly built core (dev; spawns ../bin/pixivbiu)
	cd $(DESKTOP) && npm install && npm start

desktop-dist: desktop-stage  ## Package the desktop app for the host platform+arch (electron-builder)
	cd $(DESKTOP) && npm install && npm run dist -- --$(HOST_ARCH)

# CI (.github/workflows/desktop.yml) doesn't build the core — it downloads the
# pinned release in desktop/.core-version and bundles that exact binary. This
# target reproduces that locally (needs the gh CLI). Use it instead of
# desktop-stage when you want to test the same core CLI users get, e.g.:
#   make desktop-fetch-core && cd desktop && npm run dist
desktop-fetch-core:  ## Stage the pinned core release (desktop/.core-version) into desktop/resources — mirrors CI (needs gh)
	@command -v gh >/dev/null || { echo "gh CLI required"; exit 1; }
	bash scripts/stage-core.sh "$$(tr -d '[:space:]' < $(DESKTOP)/.core-version)" $(DESKTOP)/resources

test:  ## Run tests
	go test ./...

tidy:  ## Tidy go.mod
	go mod tidy

fmt:  ## Format code
	go fmt ./...

vet:  ## Run go vet
	go vet ./...

vuln:  ## Scan for known vulnerabilities (reachability-aware, via govulncheck)
	go tool govulncheck ./...

clean:  ## Remove build artifacts (keeps the embed-dir .gitkeep)
	rm -rf bin dist
	find $(WEB_DIST) -mindepth 1 ! -name .gitkeep -delete
