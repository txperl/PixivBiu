# PixivBiu Desktop (Electron)

A thin Electron shell around the single-binary PixivBiu core. The Go binary is unchanged: the shell spawns it as a child ("sidecar"), waits for `/api/v1/health`, then proxies its embedded SPA through the stable `pixivbiu://core` origin. The random loopback port remains private to the main process.

What the shell adds:

- **Automated Pixiv login.** Instead of copying the OAuth callback URL out of DevTools, a Chromium window opens Pixiv's hosted login and intercepts the `…/auth/pixiv/callback?code=…` redirect automatically (captcha / 2FA render natively). The captured code goes straight into the existing `POST /auth/oauth/exchange`. See `src/oauth-window.ts`.
- **Whole-app updates** via `electron-updater`, off the dedicated [PixivBiu-Desktop Releases](https://github.com/txperl/PixivBiu-Desktop/releases/latest) repo (`github` provider). The shell disables the core's automatic update checks, and the desktop UI uses the shell's updater. See `src/updater.ts` and the [desktop release guide](../docs/RELEASE.md#desktop-release-train).

See [Development](../docs/DEVELOPMENT.md) for repository setup and [Release](../docs/RELEASE.md#desktop-release-train) for publishing. Dependency versions are pinned by `package.json` and `package-lock.json`.

## Protocol, security, and lifecycle

The main window loads `pixivbiu://core/`. The main window uses the in-memory `pixivbiu-main` session. Its stable origin keeps renderer storage and security checks consistent when the core restarts. `core-protocol.ts` forwards trusted core-origin requests to the current sidecar port, preserving method, body, and application headers. It removes transport/origin headers that would break the upstream request and adds the application's CSP and related response headers.

The scheme enables fetch and streaming. The response body is wrapped so consumer cancellation aborts upstream work; returning an uncancellable SSE stream would leak subscriptions and exhaust the connection pool. Preserve streaming rather than buffering a whole response. The scheme is registered before app readiness, and the protocol handler is installed afterwards.

The core starts on a selected loopback port with fallback disabled. Startup retries a port race, polls health, and reports a failure page if readiness fails. A single-instance lock prevents another shell from spawning a second core against the same data directory. The main process owns its child's lifecycle; there is no general automatic crash-restart watchdog.

Security decisions live in [security.ts](src/security.ts) and their callers:

- Main and OAuth renderers are sandboxed, with context isolation and Node integration disabled. The main renderer receives only the typed preload bridge.
- OAuth/update IPC checks the sender is the main window's main frame at the trusted core origin. Validating just the sender URL is insufficient.
- Main-window navigation stays at the core origin; external links are restricted to validated HTTP(S) URLs without credentials and opened via the OS browser.
- OAuth accepts the exact approved login and callback URLs, with clean authority. Its separate session does not expose the main preload bridge.
- Permission handlers deny unsupported capabilities; the main app allows only its explicitly scoped clipboard behavior. Do not loosen CSP, permissions, sandboxing, or navigation guards to work around a frontend bug.
- Packaging sets Electron fuses in `electron-builder.yml` and removes unused macOS hardware-permission declarations via `build/after-pack.cjs`.

Keep `preload.ts` aligned with [frontend/src/lib/desktop.ts](../frontend/src/lib/desktop.ts), and keep the OAuth callback constant aligned with `internal/pixiv/oauth_code.go`. The bridge offers OAuth capture, update operations/status subscription, a bounded UI-preference read/write API, and platform/chrome flags; it never exposes a generic IPC or filesystem API.

## Sessions and UI preferences

Normal startup never opens a persistent Chromium session or initializes `safeStorage`. The main window, protocol handler, permission policy and core proxy all use `pixivbiu-main` (no `persist:` prefix). Use that session’s `protocol` and `fetch`; global `protocol.handle` and `net.fetch` would reintroduce the persistent default session. Electron-updater uses its own in-memory session. Cookie encryption stays enabled as defense in depth for any future persistent session, but normal application and OAuth traffic have no on-disk cookie store to encrypt.

Each OAuth attempt creates a unique in-memory session with caching disabled. Completion, cancellation and timeout close the window and clear storage, cache, HTTP authentication and connections. Popups are denied so they cannot create default-session windows. Pixiv’s remembered-account/device cookies do not survive authorization attempts; occasional reauthorization may require credentials, captcha or 2FA again. The core’s persisted refresh token still maintains PixivBiu login across restarts and is separate from Electron cookies. The core token state remains a permission-restricted JSON file, not encrypted by Electron’s Cookie fuse.

Only `PARAGLIDE_LOCALE`, `pixivbiu.general-filters`, `pixivbiu.search.history.v1` and `pixivbiu.activity-bar` are persisted by the shell in versioned `userData/ui-preferences.json`. Main-process IPC checks the trusted main frame, allowed keys and size limits, and atomically replaces the file before acknowledging a write. The SPA hydrates its in-memory localStorage before importing App (including module-level preference readers and Paraglide); explicit preference writes update both the working copy and the shell store. Browser builds keep normal localStorage persistence. Storage failures fall back to usable in-memory preferences and emit diagnostics without preference contents. New persisted UI fields must be added to both explicit allowlists and use the preference adapter; tokens and generic filesystem paths are forbidden.

This internal-test transition does not import or delete old Chromium profiles or keychain entries. Previous browser-only preferences start at defaults; core settings, login and downloads retain their own storage. Development uses a separate `PixivBiu Development` identity and userData directory. Validate startup and OAuth with a signed macOS package, including a locked/denied keychain and repeated launches; TypeScript and unit tests cannot prove the absence of native prompts.

## Layout

| File | Responsibility |
|------|----------------|
| `src/main.ts` | App lifecycle; orchestrates core + window + updater; IPC handlers |
| `src/core-process.ts` | Free-port selection, core spawn, `/api/v1/health` readiness, stop-on-quit |
| `src/core-protocol.ts` | Stable renderer origin, HTTP forwarding, streamed response cancellation |
| `src/security.ts` | Shared URL, CSP, OAuth, and IPC sender policies |
| `src/window-chrome.ts` | Per-platform frameless title bar + frosted backdrop options |
| `src/preferences.ts` | Versioned, bounded and atomic persistence of non-credential UI preferences |
| `src/window-state.ts` | Persist/restore window bounds (`userData/window-state.json`) |
| `src/menu.ts` | Application menu (standard macOS roles; none in packaged win/linux) |
| `src/oauth-window.ts` | OAuth window that intercepts the Pixiv callback → returns the code |
| `src/preload.ts` | `contextBridge` → `window.pixivbiu` (the SPA mirrors this in `frontend/src/lib/desktop.ts`) |
| `src/updater.ts` | `electron-updater` wiring + IPC to the renderer |
| `electron-builder.yml` | Packaging / signing / publish config |
| `build/icon.icns` / `icon.png` | macOS bundle icon and Linux/runtime icon, generated from the Unix artwork |
| `build/icon.ico` | Multi-size Windows executable, installer, and runtime icon |
| `build/after-pack.cjs` | Removes unused hardware-permission declarations from the macOS plist |
| `build/entitlements.mac.plist` | Hardened-runtime entitlements |
| `resources/<arch>/` | The Go core binary per arch (`x64` / `arm64`), staged at build time (gitignored) |

## Window & chrome

The shell draws no separate title bar — the SPA is the whole window (`src/window-chrome.ts`):

- **macOS**: `titleBarStyle: hiddenInset`; traffic lights float over the sidebar (`trafficLightPosition`). The window uses `vibrancy: "sidebar"` with a fully transparent `backgroundColor`, so the splash is full-window frost and, once loaded, the sidebar/activity rail stay frosted while the content area paints opaque.
- **Windows 11 (22H2+)**: `titleBarStyle: hidden` + `titleBarOverlay` (transparent caption-button strip, 36px) + `backgroundMaterial: "mica"`. Older Windows falls back to a solid surface-colored window with a solid overlay.
- **Linux**: native frame, solid background (frameless/transparent windows are unreliable across compositors).

Dragging: the SPA paints a full-width invisible drag band across the top of the window (`--titlebar-inset`: 44px on macOS, `env(titlebar-area-height)` on Windows) at negative z-index, and a global CSS rule marks every interactive element `app-region: no-drag`. Chromium computes drag regions in paint order, so the band drags from any empty top pixel while buttons/inputs painted over it stay clickable — no layout shift, no title-bar row. The sidebar and the right activity rail are drag surfaces too (native macOS sidebar behavior); their nav links/buttons punch holes the same way. Custom widgets the selector list misses can opt out with `data-app-no-drag`.

The SPA learns what the shell actually did via `platform.frameless` / `platform.frost` on the preload bridge (wired through `webPreferences.additionalArguments` as `--pixivbiu-frameless` / `--pixivbiu-frost`), and only then draws drag regions (`app-drag` utilities) and translucent surfaces. Cross-version combinations degrade gracefully: a new shell with an older core renders frameless but opaque; an old shell with a newer core renders exactly as before.

Window size/position persist in `userData/window-state.json` (`src/window-state.ts`; default 1440×900, validated against the current displays on restore). On macOS, closing the window keeps the app and the core sidecar alive in the Dock (downloads keep running); clicking the Dock icon reopens the window against the same core, and only Cmd+Q quits.

## Develop

```bash
# From the repo root: build the core (embeds the SPA) so the shell has it.
make dist                              # -> bin/pixivbiu (.exe on Windows)

cd desktop
npm ci
npm start                                # tsc -> electron .
```

`npm run check` builds the shell and runs release/security contracts; `npm run typecheck` checks types without emitting. `npm run test:native` runs an isolated Electron smoke fixture (requires frontend dependencies) covering memory sessions, the protocol proxy, sandboxed preload, preference persistence and window recreation. Real Pixiv OAuth, signed-package keychain behavior, window chrome and full core shutdown still require manual native validation. The root `make desktop-dev` convenience target currently uses `npm install`; the manual sequence above uses the lockfile strictly.

In dev the shell looks for the core at `../bin/pixivbiu` (override with `PIXIVBIU_CORE_BIN`). The shell owns OS placement and passes it to the (portable) core via env, so data lands in OS-appropriate dirs, not the repo:

| Data | Location | Env |
|------|----------|-----|
| settings / auth state / download index | `userData/usr/` | `PIXIVBIU_DATA_DIR` |
| image cache (purgeable) | OS cache dir (`~/Library/Caches/PixivBiu`, …) | `PIXIVBIU_CACHE_DIR` |
| logs (rotating) | OS logs dir (`app.getPath('logs')/pixivbiu.log`) | `PIXIVBIU_LOG_FILE` |
| downloads | `~/Downloads/PixivBiu` (first-run seed) | `download.output_dir` |

The download default is seeded only when the settings file is absent and stays editable in Settings (`core-process.ts::seedFirstRunDefaults`). If the Downloads directory cannot be resolved or seeding fails, the core uses its normal default. Logs go to the configured rotating file; the startup banner still goes to stderr.

On quit, the shell terminates the core process tree on Windows; on other systems it requests termination and escalates if necessary. This is separate from a core-initiated configuration restart. The download index supports recovery after an interrupted process, not partial-byte resume.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Core fails to start | Expected binary path, executable permission, core log and settings validity |
| UI preferences disappear after launch | Check UI-preference hydration/IPC and `ui-preferences.json`; keep the stable core scheme |
| Requests hang after navigation | Verify protocol body cancellation, especially SSE cleanup |
| OAuth or updates reject IPC | Sender must be the trusted main frame; don't bypass the policy |
| No desktop update in development | Automatic update checks run only in packaged builds |
| Downloads use an unexpected folder | Saved settings and inherited environment overrides; first-run seed does not overwrite existing settings |

Before sharing logs, remove account/proxy details. Do not attach auth state files.

## Package

Desktop builds require **macOS 13 or later**, Windows 10 or later, or a current x64 Linux distribution. Electron’s cookie-encryption fuse remains enabled in packaged apps; application and OAuth sessions are in memory and do not use disk Cookie encryption. See Sessions and UI preferences above.

The desktop app is its **own** release train (`desktop-v*` tag), decoupled from the core `v*` train. CI (`.github/workflows/desktop.yml`) does not rebuild the core — it downloads the core release pinned in [`.core-version`](.core-version) and bundles that exact binary. Bump `.core-version` (+ cut a new `desktop-v*` tag) to ship a newer core to desktop users. Full flow + secrets in [../docs/RELEASE.md](../docs/RELEASE.md#desktop-release-train).

Published installers are explicitly platform-tagged and versioned:

```text
PixivBiu-Desktop-<version>-darwin-arm64.dmg
PixivBiu-Desktop-<version>-darwin-x64.dmg
PixivBiu-Desktop-<version>-windows-x64-setup.exe
PixivBiu-Desktop-<version>-linux-x86_64.AppImage
PixivBiu-Desktop-<version>-linux-amd64.deb
PixivBiu-Desktop-<version>-linux-x86_64.rpm
```

`darwin` deliberately matches the core release's machine-facing OS identifier; the release page presents it to users as **macOS**. Every release description contains direct installer links, the source `desktop-v*` tag, and the bundled core Release. Auto-update `.zip` / `.blockmap` / `latest*.yml` files remain visible in GitHub Assets but are identified as updater internals. There are no mutable, version-less installer aliases; the releases repository links users to the standard [`/releases/latest`](https://github.com/txperl/PixivBiu-Desktop/releases/latest) page instead.

Packaging is **per-arch** (`resources/<arch>/pixivbiu`): macOS ships separate arm64 + x64 builds (not a universal binary — see Signing below); Windows/Linux are x64. For fast local iteration, `make desktop-dist` builds the working-tree core and packages **the host arch only** (it stages that one core and passes `--<host-arch>` to electron-builder, which otherwise builds both macOS arches):

```bash
make desktop-dist                       # stage host-arch core -> electron-builder --<host-arch>
```

…or reproduce CI's pinned-core staging path (needs authenticated `gh`). This downloads/extracts the release archive; the staging script does not currently perform the core updater's checksum/minisign verification. On macOS `stage-core.sh` stages **both** arch slices, so a plain `npm run dist` packages both x64 and arm64:

```bash
make desktop-fetch-core                 # -> resources/x64/ (+ resources/arm64/ on macOS)
cd desktop && npm ci && npm run dist
```

### Signing / notarization (macOS)

`mac.notarize: true` + `hardenedRuntime: true` require these env vars at pack time:

- `CSC_LINK` / `CSC_KEY_PASSWORD` — Developer ID Application cert (.p12)
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` — notarization

macOS ships a **per-arch split** (arm64 + x64), not a universal binary: universal would double the bundled ~85 MB Go core (plus the Electron runtime), so ~45% of a universal download is CPU code the user can't run. Both arches build in one `electron-builder` run and share one `latest-mac.yml`; the updater picks the slice matching `process.arch`. The embedded Go executable is included in app signing. Verify the packaged app with its actual path:

```sh
codesign --verify --deep --strict --verbose=2 "/path/to/PixivBiu.app"
spctl --assess --type execute --verbose=2 "/path/to/PixivBiu.app"
```

### Signing (Windows)

Windows uses the configured **Azure Trusted Signing** integration for cloud code signing, without a local hardware token. A signature identifies the publisher; it is not a guarantee that SmartScreen will never show a warning. See [Microsoft's reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation). It's kept out of `electron-builder.yml` so an unprovisioned build still succeeds unsigned; CI injects `-c.win.azureSignOptions.*` from the `WIN_AZURE_*` repo vars (auth via `AZURE_TENANT_ID`/`_CLIENT_ID`/`_CLIENT_SECRET` secrets) only when `WIN_AZURE_ENDPOINT` is set. See [../docs/RELEASE.md](../docs/RELEASE.md#secrets--variables-desktop). Linux ships unsigned.

### Icons

The application intentionally has two platform treatments:

- `build/icon.icns` is the macOS bundle icon, generated from the 1024×1024 Unix artwork; `build/icon.png` is its 512×512 counterpart for Linux packages and the Linux runtime window.
- `build/icon.ico` is the supplied multi-size Windows artwork and is used by the executable, NSIS installer, shortcuts, and runtime window.

The runtime PNG/ICO files are copied into app resources so `BrowserWindow` can select the platform-appropriate icon explicitly. The core no longer ships a Windows `.exe` icon, so the desktop app owns all icon assets.
