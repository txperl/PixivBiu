# Development

Set up and change the Go core, React frontend, or Electron shell from a checkout. For design context, read [Architecture](ARCHITECTURE.md); for implementation constraints, read [AGENTS.md](../AGENTS.md).

## Prerequisites

- Go: use the `go` minimum and `toolchain` selection in [go.mod](../go.mod). It currently declares Go 1.26.1 with toolchain 1.26.6.
- Bun for the frontend, and GNU Make for the root targets.
- For desktop work, Node.js and npm: [desktop/package.json](../desktop/package.json) declares the minimum Node version; CI uses Node 24.
- Docker/Compose, GoReleaser, minisign, and GitHub CLI are only needed for their deployment or packaging workflows.

Root Makefile examples use a POSIX shell. On Windows, use Git Bash with Make for these examples; direct Go commands also work in PowerShell. Native desktop packaging must run on the intended platform.

## First checkout

Run from the repository root:

```sh
go mod download
cd frontend
bun install --frozen-lockfile
```

The frontend postinstall compiles Paraglide messages. Do not create generated message files by hand. Go generators are already pinned by the `tool` directive in `go.mod`; setup does not need `go get -tool ...@latest` or `go mod tidy`.

No settings template is required. Missing settings use defaults plus environment variables; the first successful settings write creates the file. Desktop can seed it before boot. Never copy another user's auth state into a checkout.

## Run locally

In terminal 1, at the repository root:

```sh
make dev
```

In terminal 2, at the repository root:

```sh
cd frontend
bun run dev
```

Open the Vite URL, normally `http://localhost:5173`. Its `/api` proxy targets `http://127.0.0.1:4001`. The backend target disables port fallback and browser auto-open: a busy 4001 fails instead of silently sending the frontend to another process. Stop an obsolete development server before starting a replacement.

Check readiness separately from Pixiv connectivity:

```sh
curl -fsS http://127.0.0.1:4001/api/v1/health
curl -fsS http://127.0.0.1:4001/openapi.json
```

Health returns `{"status":"ok"}`; login is not required. The login page handles Pixiv connectivity/proxy setup and OAuth or refresh-token sign-in. The API viewer is at `http://127.0.0.1:4001/docs`.

Under `make dev`, default state and downloads anchor to the repository root. A built executable anchors them to its own directory unless overridden; see [runtime paths](CONFIGURATION.md#runtime-paths).

## Build

From the repository root:

```sh
make dist
./bin/pixivbiu
```

On Windows, the output is `bin/pixivbiu.exe`. `make dist` builds the SPA into `internal/web/dist` before compiling the core. `make build` alone embeds whatever is already there; it does not refresh the frontend. Only `.gitkeep` is tracked in the embed directory, so a clean backend-only build serves a missing-frontend notice. Avoid `make -j dist`: the current Makefile does not order its two prerequisites against parallel execution.

`make build`, `make dist`, and the local `make desktop-*` build targets stamp the core as `dev-<commit>` (with `-dirty` for tracked changes), independently of tags on that commit. Without Git metadata the value is `dev-unknown`. To rehearse release-version behavior, pass an explicit version, for example `make dist VERSION=v3.1.0`; this overrides the development/dirty label and does not publish anything. The desktop shell still takes its own version from `desktop/package.json`.

`make help` lists the targets. `make clean` removes build outputs, including the embedded SPA. For local Electron development use `make desktop-dev`; for lockfile-based manual setup and packaging, see the [desktop guide](../desktop/README.md#develop).

## OpenAPI workflow

The [root spec](../api/openapi.yaml) owns shared schemas, parameters, responses, and references to domain PathItems in `api/paths`. Do not edit generated files.

1. Change the root schema and/or the domain path file. Keep `operationId` unique and camelCase; paths omit the `/api/v1` mount prefix.
2. Run `make gen-backend`. The pinned oapi-codegen tool updates `internal/api/server.gen.go`: Go types, `ServerInterface`, and chi glue.
3. Implement the generated methods on `APIHandler` in the appropriate domain file. The compiler enforces interface completeness; don't bypass it with a route.
4. Stop and restart `make dev` with the newly generated code. Verify its health and `/openapi.json` before generating the frontend.
5. From another terminal at the root, run `make gen-frontend`. This fetches the running server's spec and updates `frontend/src/lib/api/schema.gen.ts`.
6. Adapt feature API wrappers and UI consumers. Review both generated diffs, run the affected tests/checks, and commit spec, implementation, and generated files together.

An old process on 4001 serves its old embedded spec even after the YAML changes. Frontend generation intentionally reads the running server, not the on-disk YAML.

### Mirrored Pixiv models

Schemas with `x-go-type` alias upstream pixivgo models. Go generation uses the alias; TypeScript and API documentation use the adjacent `properties` and `required` declarations. On dependency upgrades, compare those declarations with upstream `models.go`, including every JSON field, pointer/nullability, FlexInt, and `omitempty` behavior. Don't redesign the wire shape in a handler.

Use the existing `*pixivgoImport` YAML anchor. For a nullable referenced type, use `allOf: [{ $ref: ... }]` alongside `nullable: true`. A bare nullable flag beside a reference is ineffective in OpenAPI 3.0.

The [generator config](../api/cfg.yaml) self-maps `../openapi.yaml` to the current package and enables `skip-prune` for schemas reached through cross-file refs. Keep these settings when adding path files.

## Adding or changing a setting

1. Edit [config.go](../internal/config/config.go): add the typed field and lowercase `koanf` name, `cfg` metadata, and static `baseDefaults` entry. Existing multiword segments use snake_case. Build-derived update-channel defaults are overlaid separately before Manager initialization.
2. Choose hot reload or restart. For hot values, update the owning service's live reads/Reload and [reload hooks](../cmd/server/reload.go). `Manager.Config()` stays the immutable startup snapshot.
3. Put service-level validation in [app.go](../cmd/server/app.go) using `config.WithValidator`, so startup and settings writes share it. Return `*config.PatchError` for field-specific errors; `_` is the general key.
4. Add labels/help to all four message files and the explicit resolver in `frontend/src/features/settings/i18n.ts`. Reuse a category when possible. A new category also needs `SECTION_ICONS` in `presentation.ts` and `settings_section_<id>` / `_desc` messages. Order comes from struct declaration order through `x-cfg-order`, not a second ordering list.
5. Update [Configuration](CONFIGURATION.md), including env name, default, bounds, flags, and runtime behavior. Change OpenAPI only if its wire contract changes; the reflected config schema does not need a hand-maintained key enum.
6. Test default loading, env precedence, valid/invalid writes, reset/masking, and the chosen live/restart behavior. Bump `SchemaVersion` only when old settings cannot be applied cleanly to an incompatible shape.

Reload hooks run synchronously under the Manager lock and must not block or re-enter Patch/Reset. Services retain restart-only values even when a hook receives the whole candidate config.

## Verification

Run the checks relevant to the changed behavior. These are the current CI commands, not a requirement to rebuild every subsystem for each small edit:

| Area | Working directory | Checks |
| --- | --- | --- |
| Go | Root | `gofmt -l .`, `go vet ./...`, `go test -race ./...`, `go build ./...` |
| Frontend | `frontend` | `bunx @biomejs/biome ci .`, `bun run build` |
| Desktop | `desktop` | `npm ci`, then `npm run check` |
| Vulnerabilities | Root | `make vuln` (fetches the vulnerability database) |
| Build version selection | Root | `node --test scripts/build-version.test.mjs` (Git, Bash, Make, Node required) |
| Docs only | Root | Local links/anchors, source comparisons, `git diff --check` |

CI runs Go tests on Linux and Windows and cross-compiles Windows/amd64 and Darwin/arm64. Platform helpers live in `cmd/server/platform_{unix,windows}.go`; changes to port fallback, startup errors, signals, or restart need platform coverage. Electron checks build TypeScript and run release/security contracts; they do not replace native window, OAuth, or lifecycle smoke tests.

Formatting is explicit: `make fmt` rewrites Go, and frontend `bun run check` rewrites lint/format fixes. `bun run check:unsafe` also permits unsafe fixes. Review their diffs instead of treating them as read-only checks.

## Common development problems

| Symptom | Check |
| --- | --- |
| Vite cannot reach the API | Start the backend on 4001; inspect its startup error and stop a stale listener |
| Backend shows "frontend not built" | Use Vite for development, or run `make dist` for the embedded app |
| Frontend API types did not change | Regenerate Go, restart the backend, verify `/openapi.json`, then regenerate TypeScript |
| Generated i18n imports are missing | Run the locked frontend install or `bun run paraglide:compile` |
| Saved setting seems ignored | Compare `file`, `effective`, `sources`, and `pending_restart`; environment values win |
| Downloads appeared beside `bin/` | Built binaries use their executable directory as the default data root |
| Desktop cannot start its core | Build/stage the expected binary and inspect the core log; see the desktop guide |

## Documentation maintenance

Keep documentation in the same change as the behavior it describes:

| Change | Update |
| --- | --- |
| API/model/generator behavior | Spec + generated files; this workflow and Architecture when semantics change |
| Config defaults, flags, paths | Configuration; Docker/Desktop overrides where affected |
| Backend state or lifecycle | Architecture; AGENTS only for durable implementation constraints |
| UI data flow or shared patterns | Frontend README; message README for translation conventions |
| Desktop protocol, IPC, paths | Desktop README and corresponding frontend bridge guidance |
| Build/release artifacts or channels | Release checklist and reference; Docker/Desktop instructions and root download links |
| Document structure | Docs index and incoming links, including root README translations |

Use English for technical guides and retain the root README languages. Keep procedures, facts, and design explanations in their owning document. Use relative repository links; preserve established paths and important heading anchors. Prefer links to manifests/source over repeated dependency-version inventories. Do not add historical narratives to AGENTS or claim a recommended procedure is an enforced runtime guarantee.

For a documentation-only change, verify links/anchors, commands, configuration facts, and the affected reader journeys. Builds are not a substitute for that review. Publication, signing, deletion, and update examples are instructions for the operator, not commands to execute while validating prose.
