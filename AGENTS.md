# AGENTS.md

## Project Overview

[PixivBiu](https://github.com/txperl/PixivBiu) is a Pixiv artwork browsing, searching, and downloading tool. **v3 is its next major version**, adopting Go as the implementation language and evolving the project structure to a decoupled backend + frontend monorepo.

The current backend covers **auth + read-only browsing + bookmark/follow + download + SSE event stream**, all backed by [github.com/txperl/pixivgo](https://github.com/txperl/pixivgo). Image proxy, search cache, and SauceNAO remain intentionally deferred.

## Architecture Overview

| Component | Tech Stack | Default Port | Description |
|-----------|-----------|--------------|-------------|
| **Backend** | Go + chi + oapi-codegen | 8080 | REST API server. OpenAPI-first: routes and types generated from `api/openapi.yaml`. |
| **Frontend** | React 19 + Vite + TypeScript | 5173 (dev) | SPA. Talks to backend via `/api/v1/*`. |

For **production the built SPA is embedded into the Go binary** (`go:embed`, `internal/web`) and served by the same server at `/`, so a release is a single self-contained executable and the frontend calls `/api` same-origin (no CORS). The Vite dev server (5173) only applies during development, proxying `/api` → 8080. See [Build & Release](#build--release).

## Tech Stack

### Backend (Go)

- **Language**: Go 1.26
- **Router**: [chi v5](https://github.com/go-chi/chi) — lightweight, idiomatic HTTP router
- **API codegen**: [oapi-codegen v2](https://github.com/oapi-codegen/oapi-codegen) — generates types + chi server interface from OpenAPI 3 spec. Installed as a `go tool` (Go 1.24+ tool directive).
- **Config**: [koanf v2](https://github.com/knadh/koanf) — providers for confmap (defaults + file layer) and env. The settings file is JSON (`usr/settings.json`), loaded by an in-package `Store` instead of koanf's file/yaml providers; the same Store + a reflected schema power the `/config/*` REST surface.
- **Logging**: `log/slog` (stdlib) + [go-chi/httplog v3](https://github.com/go-chi/httplog) — HTTP access logs go through httplog middleware; all events aligned to ECS schema (`SchemaECS` + `ReplaceAttr` on the slog handler)
- **Decode hooks**: `github.com/go-viper/mapstructure/v2` (for `time.Duration` parsing)
- **Animated WebP**: [HugoSmits86/nativewebp](https://github.com/HugoSmits86/nativewebp) — pure Go, zero cgo, used for ugoira → animated WebP

### Frontend

- **Framework**: React 19 + react-router 7 (SPA, no SSR)
- **Build**: Vite 8 + TypeScript (strict, bundler resolution)
- **UI**: shadcn/ui (base-nova) on `@base-ui/react` primitives + Tailwind 4; Material You dynamic color via `@material/material-color-utilities`. Compose classNames via `cn(...)` from `@/lib/utils`, not backtick template literals.
- **i18n**: [Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs) — compile-time, tree-shakeable message functions. Source + config + generated output consolidated under `src/i18n/` (barrel `index.ts`; `messages/` + `project.inlang/` + `generated/` (gitignored) + `react/{locale-provider,use-messages}`). Locales: `en` (baseLocale + fallback), `zh-CN`, `ja`. The rules below are load-bearing:
  - **Read via `const m = useMessages()`** inside render paths — it subscribes to `LocaleContext`, so a language switch rerenders without remounting. **Do not** `import { m }` from `@/i18n/generated/messages` inside components (those importers don't subscribe); module-level UI-text constants must move inside the component or a `useMemo`, or they freeze the locale at import time.
  - **Dynamic keys** use an **explicit static map** (`{ key: () => m.key() }`), never `m[dynamicKey]()` (breaks tree-shaking + types).
  - **Two-stage locale resolution.** (1) On mount, `LocaleProvider` resolves `auto` against `navigator.languages` *only* when Paraglide's localStorage cache is empty (first visit) — otherwise the cache wins, preserving the last explicit choice. Prefix matching is hand-rolled (`zh*`→`zh-CN`, `ja*`→`ja`, `en*`→`en`) because Paraglide's `extractLocaleFromNavigator` matches only exact configured locales. (2) After auth, `<LocaleSync>` (inside `AuthProvider`) fetches `GET /config` and applies the persisted `app.language`; a `PATCH` touching `app.language` calls `applyLanguage` synchronously, so a save switches the UI without reload. The unauthenticated login page relies on stage 1.
  - **Two wire→message resolvers.** `lib/api/error-message.ts::useApiErrorMessage()` keys off the error `kind` discriminator (`kind=app` + non-empty `message` → render verbatim; else `upstream.reason`→`code`→`m.error_*`, with `error.message` as final fallback). `features/settings/i18n.ts::{useFieldText,useSectionTitle}` map config `field.key`→`m.cfg_*` and section id→`m.settings_section_*`, **falling back to the backend's Chinese `field.description`/title** — the `/config/schema` text is the never-localized safety net.
  - Keys are flat **snake_case with a domain prefix** (`common_`/`nav_`/`login_`/`downloads_`/`search_`/`filter_`/`ranking_`/`user_`/`home_`/`status_`/`error_`/`settings_`/`cfg_`) and must exist in all three JSONs with the same `{param}` shape — see `src/i18n/messages/README.md`.
- **Lint/Format**: Biome (replaces ESLint + Prettier)
- **Package manager**: bun
- **Page modules**: `pages/<route>/index.tsx` only default-exports the route component; shared types/constants/helpers go in sibling files (e.g., `pages/user/tabs.ts`).

## Project Structure

```
PixivBiu-go/
├── api/                          # OpenAPI spec + codegen config
│   ├── openapi.yaml              #   Root spec: info/servers/tags/components + $ref jumps into paths/*
│   ├── paths/                    #   PathItems split by domain
│   │   ├── auth.yaml             #     /auth/*
│   │   ├── illusts.yaml          #     /illusts/*
│   │   ├── users.yaml            #     /users/*
│   │   ├── search.yaml           #     /search/*
│   │   ├── downloads.yaml        #     /downloads · /downloads/{id}
│   │   ├── events.yaml           #     /events (SSE)
│   │   └── config.yaml           #     /config · /config/schema · /config/reset · /config/restart
│   └── cfg.yaml                  #   oapi-codegen configuration (self-mapping for cross-file $refs)
├── cmd/server/main.go            # Entry point: load config → init logger → wire pixiv/inbox/download → HTTP
├── internal/
│   ├── api/
│   │   ├── gen.go                #   //go:generate directive (oapi-codegen)
│   │   ├── server.gen.go         #   ⚠️ Auto-generated by oapi-codegen — DO NOT modify manually
│   │   ├── handler.go            #   APIHandler: struct, NewHandler, helpers, error classifier
│   │   ├── handler_{auth,illusts,users,search}.go   # Per-domain handlers
│   │   ├── handler_downloads.go  #   /downloads/* + DownloadJob/Task projection
│   │   └── handler_events.go     #   /events SSE (delegates to inbox.ServeSSE)
│   ├── config/                   # Layered settings (defaults → usr/settings.json → env)
│   │   ├── config.go             #   Struct + `cfg:` tags (sole source of truth for keys, defaults, validation)
│   │   ├── manager.go            #   Manager: live config snapshot (atomic) + OnReload hooks, Patch/Reset, validators
│   │   ├── schema.go             #   Reflects Config → JSON Schema (served at GET /config/schema)
│   │   └── store.go              #   Atomic JSON read/write of settings.json (diff-against-defaults)
│   ├── atomicfile/               # Shared temp-file+rename writer used by settings/state/downloads stores
│   ├── pixiv/                    # pixivgo wrapper + background token refresh
│   ├── state/state.go            # Atomic JSON token persistence (usr/state.json)
│   ├── inbox/                    # In-memory pub-sub + SSE dispatcher (ring buffer + Last-Event-ID replay)
│   ├── download/                 # Download manager, worker pool, naming templates, ugoira conversion
│   │                             #   store.go persists usr/downloads.json atomically
│   ├── server/server.go          # chi router assembly, middleware wiring, SPA catch-all (serves internal/web)
│   └── web/web.go                # Embedded frontend: //go:embed dist/ (Vite output) + SPA/asset handler w/ index.html fallback
├── usr/                          # Gitignored; holds settings.json + state.json + downloads.json
├── downloads/                    # Gitignored; default download.output_dir
├── frontend/                     # React + Vite SPA (feature-based; kebab-case file names)
│   ├── src/
│   │   ├── main.tsx              #   Entry — mounts <App />, imports global CSS
│   │   ├── app/                  #   App shell: App.tsx + providers.tsx + router.tsx + layouts/{root-layout,root-sidebar}
│   │   ├── pages/                #   Route-level shells (thin); folder-per-route — only compose features
│   │   ├── features/             #   Domain modules: auth · illusts · users · search · ranking · downloads · events · activity-bar · filter · settings
│   │   │                         #     each owns api.ts (calls openapi-fetch) + components/ + (optional) hooks/store/types
│   │   ├── components/           #   Cross-feature shared UI; ui/ for shadcn primitives (don't put business UI here)
│   │   ├── i18n/                 #   See i18n bullet above
│   │   ├── lib/                  #   Stateless utilities — utils.ts (cn), icons.ts, format.ts (formatCount/hueFromId/formatBytes), pixiv-image.ts (TEMP pximg→pixiv.cat rewrite), fetch-state.ts (FetchState<T>), url-params.ts (readPage/patchParams), api/ (openapi-fetch client + `useApiErrorMessage` hook), theme/
│   │   └── styles/               #   globals.css + material-you.css
│   ├── package.json              #   `bun run dev | build | check`. `build` runs `paraglide-js compile` before tsc.
│   └── vite.config.ts            #   `paraglideVitePlugin` + Tailwind + React; `build.outDir` → ../internal/web/dist
├── .github/workflows/            # CI (push/PR) + Release (v* tag → GoReleaser)
├── .goreleaser.yaml              # Cross-platform release build (frontend embedded)
├── Makefile                      # gen / dev / build / build-web / dist / test / tidy / fmt / vet / clean
├── go.mod / go.sum
```

## Development Guide

### Prerequisites

1. Go 1.26+
2. `make`
3. One-time setup:
   ```bash
   go mod tidy
   go get -tool github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
   ```
   No config file step — `usr/settings.json` is auto-created (and managed) by the running server via `/api/v1/config/*`.

### Common Commands

| Command | Description |
|---------|-------------|
| `make help`   | Show all available targets |
| `make gen-backend`  | Regenerate `internal/api/server.gen.go` from `api/openapi.yaml` |
| `make gen-frontend` | Regenerate `frontend/src/lib/api/schema.gen.ts` from running backend's `/openapi.json` |
| `make dev`    | Run the server (`go run ./cmd/server -config ./usr/settings.json`) |
| `make build`  | Build backend binary to `bin/pixivbiu` (embeds the current `internal/web/dist`) |
| `make build-web` | Build the frontend into the embed dir `internal/web/dist` |
| `make dist`   | Full self-contained build: `build-web` + `build` (SPA embedded) |
| `make test`   | Run tests |
| `make tidy`   | `go mod tidy` |
| `make fmt`    | `go fmt ./...` |
| `make vet`    | `go vet ./...` |
| `make clean`  | Remove `bin/` + `dist/` and clear `internal/web/dist` (keeps `.gitkeep`) |

### Quick Verification

```bash
make dev &
curl -s http://localhost:8080/api/v1/health   # => {"status":"ok"}
open  http://localhost:8080/docs              # Scalar API Reference (interactive tester)
curl -s http://localhost:8080/openapi.json    # Raw OpenAPI spec served from the embedded binary
```

### Build & Release

The frontend is **embedded into the Go binary**, so a release is a single self-contained executable (no separate static host, no CORS).

- **Embed.** `frontend`'s Vite build emits to `internal/web/dist` (`vite.config.ts` → `build.outDir`, `emptyOutDir:false`); `internal/web/web.go` bakes it in via `//go:embed all:dist`. Only `internal/web/dist/.gitkeep` is committed (the build output is gitignored), so a backend-only `go build` still compiles — the handler then serves a "frontend not built" notice instead of the SPA.
- **Serving.** `internal/server/server.go` mounts the SPA as the chi `NotFound` catch-all: unmapped `/api/v1/*` → structured JSON 404 (`api.RouteNotFoundError`), everything else → SPA with `index.html` fallback for client-side routes (hashed `assets/*` get an immutable `Cache-Control`).
- **Version.** Injected via `-ldflags -X main.version=` (git-describe locally, the tag in releases); printed in the boot banner.
- **CI** (`.github/workflows/ci.yml`, push to master / PR): backend `gofmt` + `go vet` + `go test -race` + `go build`; frontend Biome + `bun run build` (which type-checks via `tsc -b`).
- **Release** (`.github/workflows/release.yml`, on `v*` tag): [GoReleaser](https://goreleaser.com) (`.goreleaser.yaml`) builds the frontend (via `make build-web`), cross-compiles linux/macOS/windows × amd64/arm64 (`CGO_ENABLED=0`), and publishes archives + SHA-256 checksums + a grouped changelog as a GitHub Release. **Tags must be strict semver** (`v3.0.0`, prerelease `v3.0.0-beta.1`) — legacy `v2.x.ya/b` suffixes are rejected by GoReleaser. Dry-run with `goreleaser release --snapshot --clean`.

## Key Development Rules

### OpenAPI Workflow (most important)

This is an **OpenAPI-first** project. The spec under `api/` is the **single source of truth** for all HTTP routes, request/response schemas, and model types. The spec is **split across files**:

- `api/openapi.yaml` — root: `info`, `servers`, `tags`, `components` (all schemas, parameters, shared responses), and `paths:` entries that `$ref` into sub-files.
- `api/paths/{auth,illusts,users,search,downloads,events,config}.yaml` — each file holds the PathItems for one domain, keyed by a short identifier (e.g. `login:`, `byId:`).

oapi-codegen resolves the cross-file `$ref`s directly — no bundling step. The trick is in `api/cfg.yaml`: `import-mapping: { ../openapi.yaml: "-" }` declares that the parent file (which `paths/*.yaml` refers back into for shared schemas) belongs to the same Go package, and `output-options.skip-prune: true` stops the pruner from dropping schemas that are only reachable through those cross-file refs.

The development loop:

1. **Edit `api/openapi.yaml`** (schemas/parameters/responses + top-level path refs) and/or **`api/paths/<domain>.yaml`** (operation detail).
2. **Run `make gen-backend`** — regenerates `internal/api/server.gen.go` in one pass. The generated file contains:
   - Go types for all schemas (including `Illust = pixivgo.IllustrationInfo` type aliases, via `x-go-type`).
   - The `ServerInterface` Go interface that the handler must implement.
   - Chi routing glue (`HandlerFromMux`, `HandlerFromMuxWithBaseURL`, etc.).
3. **Update the appropriate `internal/api/handler_*.go`** — add methods to `APIHandler` to satisfy new `ServerInterface` methods. The compiler will fail until every interface method is implemented (this is intentional).
4. **Run `make vet && make dev`** to verify.

#### Rules

- ⚠️ **DO NOT modify `*.gen.go` files manually.** They are regenerated on every `make gen-backend` and your edits will be lost. If the output is wrong, fix the spec or `api/cfg.yaml` instead.
- **DO NOT hand-write route registrations** in `internal/server/server.go`. Routes come from `api.HandlerFromMuxWithBaseURL(handler, router, "/api/v1")`. Adding new endpoints means editing the spec, not the router.
- **DO NOT bypass the `ServerInterface`.** Every endpoint must go through the generated interface so spec and implementation stay coupled.
- **Keep `operationId` unique and camelCase** in the spec — it becomes the Go method name on `ServerInterface` (e.g., `getHealth` → `GetHealth`).
- **Shared schemas live only in `api/openapi.yaml#/components`**. Path files reference them via `$ref: '../openapi.yaml#/components/...'`. Don't duplicate schemas across path files.
- **Pixiv types are mirrored, not remodeled.** Schemas backed by pixivgo (the wrappers `Illust` / `User` / `UserPreview` / `Novel` / `IllustDetailResponse` / `UgoiraMetadataResponse`, plus their sub-schemas `ImageUrls` / `ProfileImageUrls` / `IllustrationTag` / `Series` / `MetaSinglePage` / `MetaPage` / `NovelTag` / `UgoiraMetadata` / `UgoiraZipUrls` / `UgoiraFrame` / `Profile` / `ProfilePublicity` / `Workspace`) carry `x-go-type: pixivgo.<Type>` so oapi-codegen emits a Go alias (`type Illust = pixivgo.IllustrationInfo`) — handlers pass pixivgo values through untouched, FlexInt and `*T`-nullable semantics survive. The `properties` / `required` block sitting alongside `x-go-type` is for **non-Go consumers** (openapi-typescript, Swagger UI, `/openapi.json`) and is **ignored by oapi-codegen**. Keep both representations in sync with pixivgo's `models.go` on upgrades — drift between them silently mistypes the frontend.
- **When adding a new `x-go-type` schema, declare every JSON field from the upstream struct under `properties:` and list every always-present field (non-pointer / non-`omitempty`) in `required:`.**
- **Reuse the `*pixivgoImport` YAML anchor.** The first pixivgo-mirrored schema in `api/openapi.yaml` declares `x-go-type-import: &pixivgoImport`. Every subsequent one writes `x-go-type-import: *pixivgoImport` instead of repeating the 3-line `name` / `path` block. YAML loaders expand the alias at parse time, so generated Go and `/openapi.json` are byte-identical to the inlined form.
- **OpenAPI 3.0 nullable-on-`$ref` quirk.** A bare `nullable: true` on a `$ref` is silently ignored. To mark a `$ref` field nullable (e.g. pixivgo's `*Series` without `omitempty`), wrap it: `allOf: [{ $ref: ... }]` next to `nullable: true`. See `Illust.series` for the canonical example.
- **The `servers:` block uses `/api/v1` as base URL.** Paths in the spec are written without the `/api/v1` prefix. The prefix is applied at mount time via `HandlerFromMuxWithBaseURL`.

#### Frontend Types

The SPA consumes the same spec via [`openapi-typescript`](https://openapi-ts.dev/) + [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) — symmetric to the backend's oapi-codegen flow.

- **Generation source** is the running backend's `/openapi.json` (not the on-disk yaml), so the types reflect what the server actually serves. `make gen-frontend` requires `make dev` to be up.
- **`frontend/src/lib/api/schema.gen.ts`** is the auto-generated artefact. Like `internal/api/server.gen.go`, it is **committed** so PRs diff API changes and CI doesn't depend on the backend running. **Don't edit it by hand.**
- **`frontend/src/lib/api/{client,index}.ts`** wrap the generated `paths` into a singleton `api` client with `baseUrl: "/api/v1"`. Consumers `import { api } from "@/lib/api"` and call `api.GET("/illusts/{id}", { params: { path: { id } } })`; the response is `{ data, error }` with both branches fully typed.
- **Domain wrappers.** Features that hit the API typically expose a thin wrapper at `frontend/src/features/<domain>/api.ts` (e.g. `features/auth/api.ts` exports `getAuthStatus` / `login` / `logout`). Components/hooks call those wrappers, not `api.GET` directly — keeps UI code free of OpenAPI plumbing and gives one place per domain to massage shapes if needed.
- **Dev proxy.** `vite.config.ts::server.proxy` forwards `/api/*` from `:5173` to `:8080`, so the same `baseUrl: "/api/v1"` works in dev (proxied) and prod (same-origin).
- **Refresh loop:** edit spec → `make gen-backend` (backend types + routes) → `make gen-frontend` (frontend types; needs the backend up). The pixivgo schema sync rule above also applies to the frontend — `properties` drift in the yaml mistypes `schema.gen.ts`.

### Backend Handlers

The generated `internal/api/server.gen.go` exports a function named `Handler(si ServerInterface) http.Handler`. To avoid a name collision, our handler struct is named **`APIHandler`**, not `Handler`:

```go
type APIHandler struct { svc *pixiv.Service }
func NewHandler(svc *pixiv.Service) *APIHandler { ... }
```

When adding handler files inside `internal/api/`, attach methods to `APIHandler` (grouped by domain once the surface grows); do not introduce another type named `Handler` in this package.

- Use the `writeJSON(w, status, v)` helper already defined in `handler.go` for JSON responses.
- To attach fields to the current request's log line, use `httplog.SetAttrs(r.Context(), ...)` (or `httplog.SetError(r.Context(), err)`). Handlers should **not** emit separate log events for per-request errors — let them roll into the single `http.request` entry. Use `slog.Default()` only outside HTTP request scope (startup/shutdown, background workers).
- Return errors through proper HTTP status codes and JSON error bodies; do not `panic`. Panics are caught by `httplog.Options.RecoverPanics=true` and logged as structured Error events with `error.message` + `error.stack_trace`, but that's a safety net, not a flow-control tool.

### Configuration

Precedence (low → high): **defaults → `usr/settings.json` → environment variables**.

The settings file is **managed by the running server via `/api/v1/config/*`** — there is no user-edited template (`config.example.yaml` is gone). The Go struct in `internal/config/config.go` is the **single source of truth**: its field types feed defaults, its `cfg:` struct tags drive the reflected JSON Schema, the openapi `ConfigPatch` accepts the same dotted keys, and env-var resolution shares the same key list.

- **Adding/editing a setting** = edit `internal/config/config.go`:
  1. Add the Go field with a `koanf:"..."` tag (lowercase, no underscores).
  2. Add the entry to `defaults()` (the `sync.OnceValue` map).
  3. Tag with `cfg:"desc=...,enum=...|...,min=N,max=N,sensitive=true,restart=true,advanced=true,internal=true"` — the schema reflector picks this up. Both PATCH validation AND `GET /config/schema` come from these tags.
  4. Bump `SchemaVersion` only when changing the shape in a way older `settings.json` files can't apply cleanly.
  5. **Decide hot-reload vs restart.** Tag `restart=true` if the value is baked in at boot (listener, worker-pool size, event ring buffer, persistence paths) — it surfaces in `pending_restart` and needs `POST /config/restart`. Otherwise it hot-reloads, and you must make a service actually consume the change: read the live value per-use, or extend that service's `Reload` plus the `OnReload` hook in `cmd/server/main.go`. A "hot" field with no consumer wiring will report as applied in `effective` but silently do nothing until restart.
- **Setting keys are all lowercase** (no camelCase, no underscores) so env-var naming maps cleanly. Group multi-word concepts under nested sections (`server.timeouts.{read,write,shutdown}`) instead of using underscores in keys.
- **`time.Duration` fields** accept Go duration strings (`"15s"`, `"1m30s"`); the mapstructure decode hook handles conversion.
- **Env-var convention**: prefix `PIXIVBIU_`, underscores map to dots. Examples:
  - `PIXIVBIU_SERVER_PORT=9090` → `server.port`
  - `PIXIVBIU_SERVER_TIMEOUTS_SHUTDOWN=20s` → `server.timeouts.shutdown`
  - `PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT=gif` → `download.ugoira.format`
  - `PIXIVBIU_APP_LANGUAGE=ja` → `app.language`
- **Selective hot-reload.** A successful `Manager.Patch` / `Manager.Reset` validates, persists to `settings.json`, swaps the live effective snapshot (`effView`, an `atomic.Pointer`), and fires registered `OnReload(func(*Config))` hooks. Each service re-derives the state it can change live (logger via `slog.LevelVar`, pixiv rebuilds its client, download swaps a `dlState` atomic). So `GET /config`'s `effective` advances **immediately** for hot-reloadable keys — there is no longer a freeze-until-restart for those. (The publisher-throttle / SSE-heartbeat hooks are still wired the same way, but their `inbox.*` keys are now `internal`, so in practice they only re-apply across a restart.)
- **Restart-required keys.** Fields tagged `restart=true` are persisted but **not** applied live — their `effective` stays pinned to the boot value and, when changed via PATCH, the key is listed in `View.PendingRestart` (the wire signal for the frontend's "restart to apply" hint). See the [Configuration Reference](#configuration-reference) for the exact set and which subset is PATCH-able. Apply pending changes with `POST /config/restart`, which gracefully drains (closes SSE via `Hub.Shutdown`, waits out non-SSE within the shutdown deadline) and re-execs the process (`syscall.Exec` on unix, spawn-child on Windows — see `cmd/server/reexec_*.go`). The restart re-execs even if the drain times out, so a slow request can't strand it after the 202.
- **Reload hooks are registered in `cmd/server/main.go`.** Each hook takes the whole `*Config` because some keys cross service boundaries (`pixiv.proxy` is reused by the download HTTP client). Hooks run under `Manager`'s write lock and must never call back into `Patch`/`Reset`. Restart-required fields are pinned inside each service's `Reload`, so passing the full config is safe.
- **Sensitive masking.** Fields tagged `sensitive=true` (currently `pixiv.proxy`) are stored cleartext on disk but returned as `***` in `GET /config`. PATCH treats `"***"` or `""` for a sensitive field as **no-op**, so the frontend can safely round-trip a redacted view.
- **Program-only (`internal=true`).** Fields tagged `internal=true` (the set is listed in the [Configuration Reference](#configuration-reference)) are ops/maintenance knobs that are **not writable through the runtime API/UI**: `precheckPatch` and the keyed `Reset` reject them with a per-key error (`errInternalKey`, → HTTP 400), and `Reset(all)` preserves their existing file overrides instead of wiping them. The restriction is on the *running program* only — the file and env layers are untouched, so you still change these by hand-editing `settings.json` or via a `PIXIVBIU_*` env var. The schema emits `x-cfg-internal` and the settings UI renders them read-only under the "advanced" toggle. `internal` is orthogonal to `restart`, but because the Manager never re-reads the file at runtime, applying any hand-edit needs a restart regardless of the `restart` tag.
- **Diff-only persistence.** `Store.Save` strips keys whose value matches the built-in default before writing — `settings.json` only ever contains real user overrides. JSON-encode normalisation handles `int` vs `float64` so a round-trip doesn't grow the file.
- **Validator hook.** Service-level parse rules (download template parse, `pixiv.proxy` URL shape) register via `config.WithValidator(...)` in `cmd/server/main.go`. Validators run both at startup AND inside `Patch`/`Reset` before persisting — same invariants for boot and PATCH means a saved config will not crash the next boot. Return `*config.PatchError{Errors: map[string]string{...}}` to attach per-field messages; bare errors collapse under the generic `_` key.
- **PatchError → HTTP 400, `kind=validation`.** `handler.go::classify` recognises `*config.PatchError` and surfaces its `Errors map[string]string` verbatim as the wire's `fields` object (key `_` reserved for general messages). The wire `message` stays empty — the frontend localizes the header via `code` and renders per-field text from `fields`.
- **Path override**: `-config <path>` (default `./usr/settings.json`). If the file does not exist, defaults + env are used (no error); the file is created on the first successful PATCH.

### Logging

- **Underlying library**: standard library `log/slog`. HTTP request logs go through [go-chi/httplog v3](https://github.com/go-chi/httplog) middleware, which emits via the same `*slog.Logger`.
- **Schema**: All events (HTTP + non-HTTP) align to ECS (Elastic Common Schema). `httplog.SchemaECS.ReplaceAttr` is wired into the `slog.HandlerOptions` in `cmd/server/main.go::newLogger`, so `time→@timestamp`, `level→log.level`, `msg→message`, `error→error.message` across all events.
- **Level**: case-insensitive `debug` / `info` / `warn` / `error` (configured via `log.level`). httplog additionally **auto-levels** requests by response status: 5xx→Error, 4xx→Warn (except 429→Info), OPTIONS→Debug, otherwise Info.
- **Format**: `text` (default) or `json` (`log.format`).
- **Inside HTTP handlers**: add fields to the current request's log line via `httplog.SetAttrs(r.Context(), slog.String(...))` or `httplog.SetError(r.Context(), err)`. Do not emit standalone `h.logger.Warn("api error", ...)` events — `api.WriteError` already attaches the full error to httplog plus `error.type` (wire code) and `error.kind` (rendering discriminator) to the request entry.
- **Outside HTTP scope** (`cmd/server/main.go`, `internal/pixiv/service.go` background loop): use `slog.Default()` or the injected `*slog.Logger`. Use `slog.Any("error", err)` instead of `slog.String("err", err.Error())` so `ReplaceAttr` can normalize the key to `error.message`.
- **Request-level fields** (`http.request.method`, `url.path`, `http.response.status_code`, `event.duration`, `client.ip`, `request_id`, …) are emitted by `httplog.RequestLogger` in `internal/server/server.go`. Do not duplicate these in handler logs.
- **Backend logs are English**, always — including the startup banner, the ~6 lifecycle messages (server starting / shutdown signal / restart draining / re-exec / server stopped / drain-timeout), structured slog fields, the per-request `http.request` line, and reload-failure diagnostics. The backend has no i18n package: `app.language` is persisted as an opaque string (enum-validated, default `auto`) and surfaced through `GET /api/v1/config`. The frontend owns resolution — it reads the field and maps `auto` to `navigator.language` itself.

### Middleware

Middleware order in `internal/server/server.go` is significant:

```
RequestID → RealIP → httplog.RequestLogger → (generated routes)
```

- `httplog.RequestLogger` is configured with `RecoverPanics: true` and replaces the previous `middleware.Recoverer`. Do **not** add `middleware.Recoverer` back — you'd double-recover and lose httplog's structured panic log.
- Add new middleware **after** `httplog.RequestLogger` so any panic it causes is still caught and logged.
- Add new middleware **before** `httplog.RequestLogger` only if you need the effect to be visible in the request log line (e.g. a middleware that rewrites `r.URL.Path` or attaches a user id via `httplog.SetAttrs`).
- Do not reorder existing middleware without understanding the impact on request IDs and panic recovery.

### Graceful Shutdown

`cmd/server/main.go` drains on `SIGINT` / `SIGTERM` **and** on a `POST /config/restart` trigger. The order matters: `hub.Shutdown()` first (closes SSE subscriber channels so `ServeSSE` returns — otherwise long-lived `/events` streams block the drain until the deadline), then `srv.Shutdown(shutdownCtx)` with `cfg.Server.Timeouts.Shutdown` as the deadline to let in-flight non-SSE requests finish.

- A normal shutdown returns the `srv.Shutdown` error (and exits) if the deadline is hit.
- A **restart** re-execs unconditionally: on a drain timeout it logs a warning, force-closes (`srv.Close()`), runs the service shutdowns explicitly (deferred ones won't run across `syscall.Exec`), then `reexec()`. This guarantees the 202 from `/config/restart` is honoured even when a request outlives the deadline.

When adding long-lived streaming handlers, make them return on a hub close or request-context cancel; when adding background workers, plumb their shutdown into the same drain sequence so they stop alongside the HTTP server.

## Frontend Patterns

**Provider order is fixed:** `TooltipProvider → LocaleProvider → AuthProvider → EventStreamProvider → DownloadStateProvider → ActivityBarProvider`.

- **Event stream.** `<EventStreamProvider>` opens the `EventSource` only while authenticated and tears it down on logout; subscribers register via `useEventStream().subscribe(topic, listener)` and survive open/close cycles. Use `useRefreshOnReconnect(fn)` from `features/events` for reconnect + `system.resync` refetches.
- **Download state** is split across four hooks, all backed by `<DownloadStateProvider>` + SSE:
  - `useTrackedDownloads()` — `Map<illust_id, TrackedJob>` of active + 30-min-recent terminals (swept on a cadence).
  - `useDownloadCounts()` — global `{ activeCount, doneCount }` from counts inlined into `download.job.*` events.
  - `useDownloadMutations()` — `{ submit, cancel, remove, clear, lastError }`; fire-and-forget, SSE drives state. `clear(TERMINAL_STATUSES)` (from `features/downloads/api.ts`) wipes all terminals.
  - `useDownloadsPage({ status?, page, perPage? })` — server-paginated, local to each instance; `job.*` → debounced refetch, `task.*` → patch in place. Use `useTrackedDownloads` for global views.
- **Only `download.job.*` events write `job.status` on the client; `download.task.*` update task state only — never recompute `job.status` client-side** (the backend re-publishes `job.*` whenever its aggregation rule fires).
- Per-illust card state reads `useIllustDownloadStatus(illustId)` → `{ job, active, percent }` (`IllustDownloadButton` consumes it). `ACTIVE_STATUSES` from `features/downloads/api.ts` is the single source of "in flight"; `percent` is a byte-ratio that goes `null` (indeterminate) when any task's size is still unknown.
- **Illust list pages:** pipe raw illusts through `useFilteredIllusts(...)` (`@/features/filter`) into the grid, and register `useFilterPanel({ specialFilters, specialFiltersActiveCount, onResetSpecialFilters, totalBefore, totalAfter, quickAction })` (`@/features/activity-bar`). Compose `specialFilters` as `<FilterRow label inactive>` rows; set `quickAction: { selected, allIllustIds, onReplaceSelection, onClearSelection }` (source from `useIllustSelection()`, pass visible ids as `allIllustIds`) to enable the batch-select/download footer, and call `clearSelection()` in the fetch effect so selection resets when the list changes. Pass `null` to opt out.
- **New Activity Bar panel:** add `features/activity-bar/items/<name>.ts` (id const + payload type + `use<Name>Panel` + `use<Name>Data`) and `panels/<name>-panel.tsx`, then register in `ITEM_DEFS` (`items.ts`). Export only the typed `use<Name>Panel` / `use<Name>Data` from the barrel.
- Reuse `<DownloadsTable jobs={...} compact?>` for list rendering — `compact` hides the header + size + actions columns; its 进度 is **count-weighted** (`jobProgress`), not a byte-ratio. Use `<TooltipProvider>` (`@/components/ui/tooltip`, mounted at root with `delay={300}`); keep `aria-label` on icon-only buttons.

## Configuration Reference

The key list, defaults, and validation live in `internal/config/config.go` — the `cfg:` struct tags are the **single source of truth** (defaults, `enum`/`min`/`max`, and the `sensitive`/`restart`/`advanced`/`internal` flags). At runtime, `GET /api/v1/config/schema` returns the always-fresh reflected JSON Schema, carrying `x-cfg-restart-required` / `x-cfg-advanced` / `x-cfg-internal` / `x-cfg-sensitive` hints for the settings UI. Browse it there rather than maintaining a key list here. The four flag sets:

- **Restart-required** (`restart=true`) — persisted but applied only after `POST /config/restart`. The **PATCH-able** subset is `log.format`, `pixiv.bypass_sni`, `download.max_concurrent`; every other restart field is also `internal=true`, so it changes only via hand-edit + restart and never surfaces in `pending_restart`.
- **Internal / program-only** (`internal=true`): `server.*`, `pixiv.state_file`, `download.{referer,store_file}`, `inbox.*` — not writable through the runtime API/UI (PATCH + keyed reset rejected with 400; `reset {all:true}` preserves them; UI read-only). Edit by hand-editing `settings.json` or a `PIXIVBIU_*` env var.
- **Sensitive** (`sensitive=true`): `pixiv.proxy` — masked as `***` in `GET /config`; PATCH treats `"***"` / `""` as no-op. Must include `scheme://host`.
- **Advanced** (`advanced=true`) — de-prioritised in the settings UI (sorted below everyday fields; sections that are entirely this tier sink to the bottom behind the "advanced" toggle). `internal` fields fold into this tier and additionally render read-only.

Everything else hot-reloads and is PATCH-able — notably `app.language`, which is resolved entirely client-side, so a PATCH switches the UI immediately. Download path templates are documented in [Download Module](#download-module).

## API Surface

All endpoints are mounted under `/api/v1`. **The OpenAPI spec is the source of truth** for routes, params, and schemas — browse it interactively at `/docs` (Scalar) or raw at `/openapi.json` (both dev-only, outside `/api/v1`). Success responses return the resource directly (clean REST); errors return the envelope below.

Behavioral notes the spec carries but are easy to miss:

- `POST /auth/connectivity` — pre-login reachability probe; `reachable:false` is a normal **200**, not an error. An optional `{proxy}` is tested live and, pre-login only, persisted to `pixiv.proxy` so the imminent OAuth uses it.
- **Pagination** — Pixiv-backed lists carry `next_offset` or `next_max_bookmark_id` (pass non-null back unchanged; null = end-of-list). `GET /downloads` instead uses `page` / `per_page`, is newest-first, and returns `total + active_count + done_count`.
- `DELETE /downloads/{id}` and `DELETE /downloads` are **history-log deletes only — they never touch disk**; `clearDownloads` 400s if any supplied status is non-terminal (empty = all terminal).
- `GET /config` masks sensitive fields and lists restart-required keys in `pending_restart`; `POST /config/restart` returns 202 then drains + re-execs (downloads re-enqueue, SSE reconnects — non-destructive).

**Error envelope.** `internal/api/handler.go::classify` is the **only** place that constructs `Error{}`; every endpoint funnels through `api.WriteError(w, r, err)` (also wired to oapi-codegen's `ChiServerOptions.ErrorHandlerFunc`, so generated parameter-validation failures share the envelope). Raw `err.Error()` text is never read into the wire body — the full error goes to httplog instead. Fields:

- `code` — one of 8 stable tokens (see list below). Machine-readable.
- `kind` — rendering discriminator: `validation` (input failed; render `fields`), `app` (backend/synthetic-authored text; `message` is safe to show verbatim when non-empty, else localize by `code`), `upstream` (Pixiv rejected — `message` is empty; `upstream.reason` carries a stable i18n key), `internal` (unclassified 500; `message` is empty, localize by `code`).
- `message` — empty for sentinels and generic placeholders, populated only when a `UserError` opt-in or frontend-synthetic call site authored specific text (e.g. `UnknownStatusError`). Frontend trusts non-empty messages for `kind=app` and falls back to `m.error_*` keyed by `upstream.reason` or `code` otherwise.
- `fields` — present only on `kind=validation`. `map[string]string` keyed by dotted config path or oapi-codegen parameter name; the reserved key `_` carries a non-field general message. `*config.PatchError.Errors` is surfaced verbatim; oapi-codegen errors (`InvalidParamFormatError` / `RequiredParamError` / `UnmarshalingParamError` / `RequiredHeaderError` / `UnescapedCookieParamError` / `TooManyValuesForParamError`) become a single-entry map with a hardcoded safe summary — wrapped `Err` text is intentionally dropped.
- `upstream` — present only on `kind=upstream`. `{status: int, reason: "invalid_grant" | "rate_limit" | "generic"}`. The raw Pixiv body is **never** on the wire; `classifyPixivBody` reads it server-side to pick a stable reason token, the body itself goes only to httplog.
- `request_id` — chi `RequestID` middleware token; absent for client-side synthetic errors. Surface this when showing `kind=internal` so users can quote it for log lookup.

**Adding a service-layer error.** Two paths: (a) add a sentinel to the `sentinelErrors` table in `handler.go` (just `{err, code, status}` — message stays empty; frontend localizes); (b) implement `UserError` on a typed error if the message has dynamic content (e.g. `UnknownStatusError.UserMessage()` interpolates the bad value). Never construct `Error{}` directly outside `classify` — `TestClassify_MessageNeverLeaks` asserts no Go package prefix or non-ASCII rune leaks through `message`, so a regression is caught at test time.

**Code list:**
- `unauthenticated` / 401 — no/expired access token; POST `/auth/login` first.
- `bad_request` / 400 — malformed input / invalid illust / missing or expired PKCE state / missing auth code / param validation failure.
- `forbidden` / 403 — upstream 403 (e.g., restricted / deleted illust).
- `not_found` / 404 — upstream 404 / unknown download job / unmapped API route (`RouteNotFoundError`).
- `conflict` / 409 — cancelling a terminal job, or removing a non-terminal one.
- `rate_limited` / 429 — upstream 429.
- `upstream_error` / 502 — any other upstream failure.
- `internal_error` / 500 — unclassified.

## Token State

`internal/state/state.go` atomically manages `usr/state.json`:

```json
{
  "refresh_token": "...",
  "access_token": "...",
  "access_token_expires_at": "2026-04-18T12:34:56Z",
  "user_id": 12345,
  "user_name": "..."
}
```

- File is the **sole** source of truth — tokens must never live in `settings.json` or env vars.
- File is gitignored (`/usr/` in `.gitignore`). Mode `0600`, parent dir mode `0700`.
- `internal/pixiv/service.go` runs a background refresh loop that calls `client.Auth()` whenever the access token has < 5 min left, then overwrites the file.
- On first boot with no state file, the server is "unauthenticated" — all non-`/health`, non-`/auth/*` endpoints return 401.

**OAuth (PKCE) login flow.** Pixiv's mobile OAuth uses the `pixiv://` URL scheme for its callback, so a desktop browser cannot land on the callback URL — the navigation silently fails. The pragmatic UX is: open Pixiv's hosted login in a popup, ask the user to capture the `…/auth/pixiv/callback?code=…` URL from **DevTools › Network** (with Preserve log enabled), and paste it back. `internal/auth/pkce.go` keeps issued PKCE verifiers in an in-memory `Store` (TTL 10 min, capped at 64 entries, single-use). The handler stitches `/auth/oauth/start` (issue) and `/auth/oauth/exchange` (consume + `Service.LoginWithAuthCode`) together; the actual `authorization_code` grant lives in `internal/pixiv/oauth_code.go` because pixivgo only implements the refresh-token grant. `extractAuthCode` (in `handler_auth.go`) accepts either the full callback URL or a bare code so the user doesn't have to pre-process. Once the exchange returns a refresh token, the rest of the path (access-token persistence, background refresh loop) is shared with `/auth/login` — there's only one code path keeping `usr/state.json` honest. Front-end captures this flow as a dedicated **`/login` route** (`frontend/src/pages/login/`), and `<RootLayout>` redirects every unauthenticated visit there with `state={{ from: location }}` so the page can land users back where they were headed. The page walks through four stages (welcome → connectivity → login → ready) driven by local state; the popup is anchored to the right side of the browser window so it doesn't cover the left-aligned content. The **connectivity** beat (`pages/login/components/connectivity-panel.tsx`) runs before sign-in: it calls `POST /auth/connectivity` to confirm the backend can reach Pixiv and, when it can't, flows in a proxy input the user tests live — a working proxy is persisted to `pixiv.proxy` through `APIHandler.persistOnboardingProxy`, an unauthenticated write guarded by `!svc.Authenticated()` so it only happens pre-login (after login, proxy edits go through the auth-gated Settings page), letting the OAuth that follows traverse it. That OAuth popup opens from this step's continue button rather than on mount, keeping `window.open` inside a real user gesture. Pasted-value validation lives in `features/auth/utils.ts::detectPasteIssue` — if the value parses as a URL but has no `code=` (or hostname is `accounts.pixiv.net`), it returns a `PasteIssue` kind (not a hardcoded string, since it's not a component) that the login panel renders as a **localized** inline hint pointing the user back to the Network panel rather than round-tripping to Pixiv and getting an opaque 400. Upstream Pixiv errors no longer reach the client as a JSON blob — `internal/api/errors.go::classifyPixivBody` reads the body server-side, picks a stable token (`invalid_grant` / `rate_limit` / `generic`), and surfaces it as `upstream.reason` in the wire envelope (the body itself is logged via `httplog.SetError` but never marshalled). `pages/login/components/error-block.tsx` reads that envelope: the main line goes through `useApiErrorMessage` (which maps `invalid_grant` / `rate_limit` to dedicated `m.error_upstream_*` keys), and the chrome shows `code · Pixiv {upstream.status}` plus `request_id` for log lookup.

## Download Module

**Architecture.** `internal/download` is self-contained: the HTTP layer only uses `Manager.{Submit,List,Get,Cancel,Remove,RemoveTerminal}` and a generic `inbox.Publisher` interface — it does not know about SSE. `internal/inbox` owns the transport.

**Persistence.** `usr/downloads.json` is written atomically (temp file + rename, 0600) on every state transition (queued → running → terminal). Progress ticks are NOT persisted — they flow through the inbox only. On restart the manager reloads the file and re-queues any `queued`/`running` tasks (no resume-in-place; files are overwritten on replay).

**Concurrency.** A worker pool of `download.max_concurrent` goroutines drains a buffered `chan *Task`. Per-task retry uses exponential backoff (capped at 30s); non-retryable classes are `ctx.Canceled`, local FS errors, and explicit 4xx (except 408/429). Each HTTP GET writes to `<target>.<taskID>.part` first; cancel or error always removes the partial file.

**Transactional cleanup.** Job is the transaction boundary: when it aggregates to `failed` or is moved to `cancelled`, every task file the job actually renamed onto `FilePath` is deleted. Ownership is recorded in `Task.WroteFile`, set in `runDownloadWithRetries` right after the successful rename — collision resolution makes the destination path unique at Submit/Start time, but a user or another process could still create a file at that path before cleanup runs, and `WroteFile` is what keeps cleanup from deleting it. Both the worker end-of-task path and `Manager.Cancel` funnel through `transitionJobLocked`; the helper collects cleanup paths, the caller does the IO outside `m.mu`. `Manager.Remove` / `Manager.RemoveTerminal` are history-log deletes only and never touch disk — physical file removal is out of the app's surface.

**Collision handling.** At Submit time the manager runs `ResolveCollision` on each task's *final* on-disk path; ugoira tasks resolve final + intermediate `.zip` together via `ResolveCollisionPair` so both paths share a suffix and neither can clobber an existing file. When the candidate is already on disk or already reserved by another in-flight job's task, a browser-style ` (1)`, ` (2)`, … suffix is appended before the extension. After 9999 numbered attempts the fallback is a random 8-hex-digit suffix, also checked against the same constraint. Restart recovery re-runs the resolver, except for tasks that already wrote their payload (`WroteFile=true`) — those keep their FilePath so resumed conversion doesn't orphan the existing file.

**Path templates (text/template).** Parsed once at boot — a bad template fails `NewManager` and boots abort. Variables: `.IllustID .Title .Type .UserID .UserName .CreatedAt .Now .Index .Ext .Home .Root`. Funcs: `sanitize pad date lower upper trunc default`. **`trunc` counts runes, not bytes** (so `trunc 2` on "曲奇" keeps both chars). The renderer applies a final byte-level clamp (≤240 bytes per filename, extension preserved) and sanitises every path segment even when the template omits `| sanitize` — user-supplied `.Title` / `.UserName` are also pre-sanitised in the manager so pixiv titles with `/` cannot sneak in subdirectories. Literal `/` in the template IS an explicit author choice for subdirectories. **`output_dir` may be absolute** (`/mnt/pixiv`, `{{.Home}}/Downloads`, `C:\pixiv`) — the leading anchor is preserved. A **relative `output_dir` is anchored to the executable's directory** (`ExecRoot()`), so the on-disk location does not drift with the launch CWD. Under `go run` (e.g. `make dev`) the anchor falls back to the process CWD because the toolchain's `go-build*` temp dir is wiped on exit. `file_template` / `file_group_template` are **always treated as relative to `output_dir`** — a leading `/` in those is normalised away.

**Ugoira.** `download.ugoira.format` = `webp` (nativewebp, animated VP8X+VP8L), `gif` (stdlib `image/gif`, Plan9 palette), or `none` (keep zip). Conversion runs synchronously in the worker after zip download; a conversion error flips the task/job to `failed`. The format is **pinned per job** (`Job.UgoiraFormat`, set at Submit) so a hot-reload of `download.ugoira.format` can't desync a job's conversion output from the on-disk path reserved at Submit.

**Events.** `Publisher` in `download/publisher.go` centralises topic/type naming and throttles `download.task.progress` events (configurable `inbox.progress_throttle`, default 250ms). Terminal task transitions bypass the throttle and also flush one final progress tick so UI progress bars snap to 100%.

**Note on pixivgo limitation.** `pixivgo.ImageUrls` does not expose the `original` field, so multi-page illusts currently download the `large` resolution. Single-page illusts use `meta_single_page.original_image_url` (full quality). Fix requires an upstream pixivgo change.

## Inbox / SSE

Single `GET /events` serves every event topic (broadcast). Clients pick a subset via `?topics=download,system`. Reconnect semantics:

1. Client sends `Last-Event-ID`.
2. Hub checks its ring buffer (cap = `inbox.buffer_size`, default 200).
3. **Hit**: replay events after that ID, then switch to live stream.
4. **Miss**: emit one `system.resync` event (payload `{"reason":"buffer_evicted"}`) and switch to live stream — the client should re-fetch authoritative state via REST (`GET /downloads`, `GET /auth/status`, …).

This is the standard **state-authoritative, events-as-optimisation** pattern: persistent state lives in JSON files, events are ephemeral. No event ever contains data that cannot be reconstructed from a REST call.

Event wire format:
```
id: <monotonic ULID-ish ID>
event: <topic>.<type>        # e.g. "download.task.progress"
data: {id, ts, topic, type, data}
```

A comment line `:keepalive` is sent every `inbox.heartbeat` (default 15s) to keep proxies from idling out the connection.

## Out of Scope (Current Phase)

The following are intentionally **not** implemented yet — do not add them without explicit instruction:

- `i.pximg.net` reverse-proxy endpoint — frontend currently bridges image URLs to `i.pixiv.cat` client-side via `frontend/src/lib/pixiv-image.ts::rewritePximgUrl` (used by `components/pximg-image.tsx`). Drop that helper once a server-side proxy lands.
- aria2 backend
- Resume-in-place (partial chunks) for downloads
- Persistent unread-notification inbox (events are ephemeral by design)
- SauceNAO / reverse image search
- Search result caching
- Rate-limiting / quota middleware
- Metrics, tracing, health probes beyond `/health`
- Database, ORM, migrations
- Docker images (releases are single self-contained binaries — see [Build & Release](#build--release); CI + tag-driven GitHub Releases are implemented)

When adding features, prefer **extending the OpenAPI spec first**, then generating and implementing — not inventing ad-hoc routes or helper packages.
