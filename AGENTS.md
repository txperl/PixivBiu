# AGENTS.md

## Project and scope

PixivBiu v3 is a Go backend + React SPA + Electron shell monorepo for browsing, searching, bookmarking, following, and downloading Pixiv artwork. The Go release embeds the SPA and runs as one portable executable. Docker packages that executable; desktop packages a pinned core with Electron.

Use this file for implementation constraints. Read the relevant linked guide before changing a subsystem; implementation explanations belong in those guides. Keep this root file concise (under 12 KiB). Write each prose paragraph on one source line; let the editor wrap it visually. Preserve Markdown block structure.

## Sources of truth

| Subject | Authority |
| --- | --- |
| HTTP routes and wire models | [OpenAPI spec](api/openapi.yaml), including referenced path files |
| Config keys, flags, defaults | [Config structs and defaults](internal/config/config.go); reflected schema and validators in the same package |
| Commands and dependencies | [Makefile](Makefile), [go.mod](go.mod), package manifests and lockfiles |
| Backend assembly and reload | [app.go](cmd/server/app.go), [reload.go](cmd/server/reload.go), [serve.go](cmd/server/serve.go) |
| Frontend patterns | [frontend guide](frontend/README.md), existing feature implementations |
| Desktop policy and bridge | [desktop guide](desktop/README.md), [security.ts](desktop/src/security.ts), [preload.ts](desktop/src/preload.ts) |
| Release behavior | [workflows](.github/workflows), [.goreleaser.yaml](.goreleaser.yaml), [desktop packaging](desktop/electron-builder.yml) |

Reconcile prose against these sources when behavior changes. Do not change working code to match a stale example or infer features from historical notes. Do not read, print, or commit real tokens, proxy credentials, or signing secrets.

## Read and verify by task

Commands below run from the repository root unless stated otherwise. Use the detailed [development guide](docs/DEVELOPMENT.md) for setup and workflow order.

| Task | Read first | Relevant verification |
| --- | --- | --- |
| Backend or HTTP API | [Architecture](docs/ARCHITECTURE.md), [API workflow](docs/DEVELOPMENT.md#openapi-workflow) | Focused Go tests, `go vet ./...`; regenerate both clients after spec changes |
| Config or runtime paths | [Configuration](docs/CONFIGURATION.md), [adding settings](docs/DEVELOPMENT.md#adding-or-changing-a-setting) | Config/runtimepath and affected service tests |
| Frontend | [Frontend guide](frontend/README.md), [message conventions](frontend/src/i18n/messages/README.md) | In `frontend`: `bunx @biomejs/biome ci .`, `bun run build` |
| Downloads, events, image proxy | [Architecture](docs/ARCHITECTURE.md) | Affected Go tests; `-race` for concurrency changes; relevant UI scenarios |
| Desktop | [Desktop guide](desktop/README.md) | In `desktop`: `npm run check`; native smoke test for lifecycle/window changes |
| Packaging or releases | [Release guide](docs/RELEASE.md), [Docker guide](docs/DOCKER.md) | Relevant config/build checks; publishing is a separate action |
| Documentation only | [Docs index](docs/README.md), cited source files | Links, anchors, command accuracy, factual consistency, `git diff --check` |

Run checks appropriate to the change. CI also runs Go race tests on Linux and Windows, cross-build checks, govulncheck, the frontend build, and desktop contracts. Report what ran and any unverified platform behavior; don't claim a native test from a cross-build alone.

## Setup and generated files

- Go versions and tools are pinned in `go.mod`; use `go mod download` for setup. Do not install `oapi-codegen@latest` or run `go mod tidy` as routine setup.
- Use Bun in `frontend` (`bun install --frozen-lockfile`) and npm in `desktop` (`npm ci`). Preserve lockfiles unless dependencies actually change.
- `make dev` pins backend port 4001 and disables auto-open. Start Vite separately on 5173; it proxies `/api` to 4001.
- `make build` embeds the current `internal/web/dist`; `make dist` builds the SPA first. A backend-only build may serve the "frontend not built" notice.
- Never hand-edit `internal/api/server.gen.go` or `frontend/src/lib/api/schema.gen.ts`. Regenerate and commit them together with their spec changes. Paraglide output and built assets are gitignored.
- `bun run check` in the frontend writes fixes. Use Biome `ci` for a read-only check; apply formatting deliberately, without unrelated churn.

## HTTP and backend rules

- Edit the spec before implementing an endpoint. Keep operation IDs unique and camelCase; shared schemas belong in the root spec, referenced by domain paths.
- All API endpoints go through the generated `ServerInterface` and `api.HandlerWithOptions`. Do not hand-register API routes in the router. The server's existing `/docs` and `/openapi.json` handlers are separate.
- Add handler methods to `APIHandler`, not a new `Handler` type (that name collides with generated code). Use `writeJSON` and `WriteError`.
- Pixiv-backed types are aliases to pixivgo, not locally redesigned models. Keep OpenAPI properties/required fields aligned with upstream JSON tags. Reuse `*pixivgoImport`; preserve pointer/FlexInt behavior.
- In OpenAPI 3.0, nullable references use `allOf` plus `nullable: true`; bare `nullable` beside `$ref` does not express the intended contract.
- Centralize wire errors in `classify`. Use registered sentinels or the `UserError` opt-in for safe authored messages. Never expose arbitrary `err.Error()` or upstream bodies through the response.
- Request errors attach to httplog through `WriteError`/`httplog.SetError`. Avoid a second per-request log event. Background logs use slog, English text, and `slog.Any("error", err)` so ECS normalization applies.
- Preserve RequestID → RealIP → httplog ordering and its panic recovery. Do not add a second Recoverer; new middleware normally goes after httplog.
- Most endpoints require an active Pixiv session; this is a shared local application, not per-browser user authentication. Preserve the explicit open endpoint exceptions and the update-apply `X-PixivBiu-App` guard.

## Configuration and lifecycle rules

- Define keys with `koanf` tags, metadata with `cfg` tags, and static defaults in `baseDefaults`. Lowercase snake_case segments are valid; don't rename existing keys to remove underscores.
- Settings layer defaults → file → environment. Persist through the config Manager/Store; use shared atomic-file writing for application state.
- A hot setting needs a live consumer or reload hook. `Manager.Config()` is the immutable startup snapshot; do not mutate it or use it as a live reader.
- Register validators in `cmd/server/app.go` and reload hooks in `cmd/server/reload.go`. Hooks run under the Manager lock; they must not block or re-enter `Patch`/`Reset`. Keep restart-only service values pinned.
- Preserve masking, internal/hidden reset exceptions, and diff-only persistence. Bump `SchemaVersion` only for incompatible settings shape changes.
- Config labels/help text belong to frontend messages and static resolvers, not backend schema text. Update all four locales and section metadata.
- Core path placement uses `runtimepath`; the shell chooses OS-specific dirs. Preserve explicit `-config` CWD semantics and data/cache root overrides.
- Keep tokens in the state store, never in settings or environment variables. Refresh-token rejection expires the session; transient failures do not.
- Close SSE subscriptions before draining HTTP. Streaming handlers must finish on cancellation; background workers must participate in shutdown. Restart must still re-exec after a drain timeout, with explicit service cleanup.

## Download, event, and image rules

- Download Manager owns jobs/tasks; inbox owns SSE transport. Persistent state is authoritative and events are reconstructible notifications.
- Persist durable job/task state, not progress ticks. Recovery requeues interrupted work; it does not resume partially downloaded byte ranges.
- Preserve per-job output format, collision reservations, partial-file cleanup, and written-file ownership. Failure/cancel cleanup only targets job-owned files. Removing download history must never delete downloaded files.
- Sanitize template path segments and clamp filename bytes while preserving extensions. User titles cannot introduce directories; literal template separators can. Keep output-root and relative filename semantics distinct.
- Replay via Last-Event-ID; on `system.resync`, clients refetch REST state. Only `download.job.*` events set client job status; task events don't derive it.
- Keep the image proxy allowlist on both input URLs and upstream redirects, bounded downloads, singleflight fetches, and disk-based cache reconciliation.

## Frontend and desktop rules

- Pages are thin route shells; `pages/<route>/index.tsx` only default-exports the component. Put shared helpers/types/constants in sibling files.
- Feature API adapters own openapi-fetch calls. Use query-options factories, shared pagination helpers, and `unwrap` for TanStack Query.
- Clear Query state across account changes. Keep bookmark optimism in the shared cache and invalidate affected lists after mutations.
- Render localized text through `useMessages()`; use explicit static message maps, never dynamic indexing or module-level evaluated UI text.
- Use `cn(...)` for class composition and existing shadcn/Base UI primitives. Icon-only controls need accessible labels; preserve provider dependencies.
- Pixiv images use `PximgImage`, including proxy rewriting and decoded reveal. Use its `fit` prop; its `className` styles the wrapper.
- Page scroll tools target `[data-app-scroller]`, not window or main. Reuse the existing list loading, filter, selection, and download state helpers.
- Feature-detect `window.pixivbiu`; keep preload and frontend bridge types in sync. Renderer code never receives unrestricted Node/Electron capabilities.
- Preserve the stable `pixivbiu://core` origin, streaming proxy cancellation, sandbox/context isolation, trusted-main-frame IPC checks, OAuth URL validation, and external navigation policy.
- Desktop updates use electron-updater; the SPA ships inside the core. Preserve independent `v*` and `desktop-v*` trains and the pinned core bundle.

## Boundaries and documentation maintenance

Do not add these without a task that asks for them: aria2, partial-byte download resume, persistent unread inbox, SauceNAO/reverse search, backend search-result cache, quota middleware, metrics/tracing, extra health probes, or a database. Frontend Query caching already exists; Docker is implemented.

When behavior changes, update its owning document in the same change. Keep complete config tables in the configuration guide, release procedures in the release guide, and detailed subsystem rules in the linked guides. The [maintenance map](docs/DEVELOPMENT.md#documentation-maintenance) identifies which docs to update. Do not duplicate historical implementation narratives here.
