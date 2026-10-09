# PixivBiu Desktop (Electron)

A thin Electron shell around the single-binary PixivBiu core. The shell launches the same portable Go binary as a managed child ("sidecar"), waits for the private protocol handshake and `/api/v1/health`, then proxies its embedded SPA through the stable `pixivbiu://core` origin. The random loopback port remains private to the main process.

What the shell adds:

- **Automated Pixiv login.** Instead of copying the OAuth callback URL out of DevTools, a Chromium window opens Pixiv's hosted login and intercepts the `…/auth/pixiv/callback?code=…` redirect automatically (captcha / 2FA render natively). The captured code goes straight into the existing `POST /auth/oauth/exchange`. See `src/oauth-window.ts`.
- **Whole-app updates** via `electron-updater`, off the dedicated [PixivBiu-Desktop Releases](https://github.com/txperl/PixivBiu-Desktop/releases/latest) repo (`github` provider). The shell disables the core's automatic update checks, and the desktop UI uses the shell's updater. See `src/updater.ts` and the [desktop release guide](../docs/RELEASE.md#desktop-release-train).

See [Development](../docs/DEVELOPMENT.md) for repository setup and [Release](../docs/RELEASE.md#desktop-release-train) for publishing. Dependency versions are pinned by `package.json` and `package-lock.json`.

## Protocol, security, and lifecycle

The main window loads `pixivbiu://core/`. The main window uses the in-memory `pixivbiu-main` session. Its stable origin keeps renderer storage and security checks consistent when the core restarts. `core-protocol.ts` forwards trusted core-origin requests to the current sidecar port, preserving method, body, and application headers. It removes transport/origin headers that would break the upstream request and adds the application's CSP and related response headers.

The scheme enables fetch and streaming. The response body is wrapped so consumer cancellation aborts upstream work; returning an uncancellable SSE stream would leak subscriptions and exhaust the connection pool. Preserve streaming rather than buffering a whole response. The scheme is registered before app readiness, and the protocol handler is installed afterwards.

The core starts on a selected loopback port with fallback disabled. Startup retries only a confirmed port conflict (three attempts maximum), requires the managed protocol handshake and bound-port acknowledgement, and polls health for up to 20 seconds per attempt. A single-instance lock prevents another shell from spawning a second core against the same data directory. The window appears with a startup page while readiness is pending. Startup failures and unexpected runtime exits show an authored failure page with retry and log-folder actions; raw child diagnostics never become page content. There is no general automatic crash-restart watchdog.

The startup page initially shows a centered 4×4 matrix of square dots, pulsing diagonally from top-left to bottom-right. It uses the transitions-dev Matrix dot loader and Texts reveal patterns: after three seconds, `Opening PixivBiu…` rises 12px into place while fading in and clearing a 3px blur over 500ms, without moving the loader. The startup document leaves both the root and body transparent on macOS and Mica-capable Windows, exposing the same native backdrop configured for the sidebar; its dots and status follow the system light/dark appearance before the SPA loads. Linux and older Windows retain the solid surface fallback, and forced-colors mode uses the system Canvas background. Failure pages retain their solid background. Browser previews cannot reproduce the native material. The status is available to assistive technology from the start. Reduced-motion and forced-colors modes keep the dots static and reveal the text after the same delay without a transition. The page requires no core, external assets or new IPC; its small, fixed reveal script is authorized by a SHA-256 hash in the startup document's CSP, while arbitrary inline scripts remain blocked. Core readiness navigates directly to the SPA with no minimum splash duration or animation-completion gate. Failure/retry behavior and the native title-bar/fullscreen reservation remain owned by the existing lifecycle and chrome helpers.

Security decisions live in [security.ts](src/security.ts) and their callers:

- Main and OAuth renderers are sandboxed, with context isolation and Node integration disabled. The main renderer receives only the typed preload bridge.
- OAuth/update IPC checks the sender is the main window's main frame at the trusted core origin. Validating just the sender URL is insufficient.
- Main-window navigation stays at the core origin; external links are restricted to validated HTTP(S) URLs without credentials and opened via the OS browser.
- OAuth accepts the exact approved login and callback URLs, with clean authority. Its separate session does not expose the main preload bridge.
- Permission handlers deny unsupported capabilities; the main app allows only its explicitly scoped clipboard behavior. Do not loosen CSP, permissions, sandboxing, or navigation guards to work around a frontend bug.
- Packaging sets Electron fuses in `electron-builder.yml` and removes unused macOS hardware-permission declarations via `build/after-pack.cjs`.

Keep `preload.ts` aligned with [frontend/src/lib/desktop.ts](../frontend/src/lib/desktop.ts), and keep the OAuth callback constant aligned with `internal/pixiv/oauth_code.go`. The bridge offers OAuth capture, update operations/status subscription, a bounded UI-preference read/write API, platform/chrome flags, and read-only fullscreen state; it never exposes a generic IPC or filesystem API.

## Sessions and UI preferences

Normal startup never opens a persistent Chromium session or initializes `safeStorage`. The main window, protocol handler, permission policy and core proxy all use `pixivbiu-main` (no `persist:` prefix). Use that session’s `protocol` and `fetch`; global `protocol.handle` and `net.fetch` would reintroduce the persistent default session. Electron-updater uses its own in-memory session, and release-notes stitching fetches through the in-memory `pixivbiu-release-notes` session. Cookie encryption stays enabled as defense in depth for any future persistent session, but normal application and OAuth traffic have no on-disk cookie store to encrypt.

Each OAuth attempt creates a unique in-memory session with caching disabled. Completion, cancellation and timeout close the window and clear storage, cache, HTTP authentication and connections. Popups are denied so they cannot create default-session windows. Pixiv’s remembered-account/device cookies do not survive authorization attempts; occasional reauthorization may require credentials, captcha or 2FA again. The core’s persisted refresh token still maintains PixivBiu login across restarts and is separate from Electron cookies. The core token state remains a permission-restricted JSON file, not encrypted by Electron’s Cookie fuse.

Only `PARAGLIDE_LOCALE`, `pixivbiu.general-filters`, `pixivbiu.search.history.v1` and `pixivbiu.activity-bar` are persisted by the shell in versioned `userData/ui-preferences.json`. Main-process IPC checks the trusted main frame, allowed keys and size limits, and atomically replaces the file before acknowledging a write. The SPA hydrates its in-memory localStorage before importing App (including module-level preference readers and Paraglide); explicit preference writes update both the working copy and the shell store. Browser builds keep normal localStorage persistence. Storage failures fall back to usable in-memory preferences and emit diagnostics without preference contents. New persisted UI fields must be added to both explicit allowlists and use the preference adapter; tokens and generic filesystem paths are forbidden.

This internal-test transition does not import or delete old Chromium profiles or keychain entries. Previous browser-only preferences start at defaults; core settings, login and downloads retain their own storage. Development uses a separate `PixivBiu Development` identity and userData directory. Validate startup and OAuth with a signed macOS package, including a locked/denied keychain and repeated launches; TypeScript and unit tests cannot prove the absence of native prompts.

## Layout

| File | Responsibility |
|------|----------------|
| `src/main.ts` | App lifecycle; orchestrates core + window + updater; IPC handlers |
| `src/core-process.ts` | OS paths, first-run defaults and managed-core environment |
| `src/core-supervisor.ts` | Single-flight startup, protocol handshake, readiness, settings restart and bounded shutdown |
| `src/core-diagnostics.ts` | Bounded startup/stderr snapshots, independent of the core business log |
| `src/core-protocol.ts` | Stable renderer origin, HTTP forwarding, streamed response cancellation |
| `src/security.ts` | Shared URL, CSP, OAuth, and IPC sender policies |
| `src/window-chrome.ts` | Platform title bars/backdrops, fullscreen notifications and startup-page chrome |
| `src/startup-screen.ts` | Self-contained, accessible pre-core loading presentation |
| `src/preferences.ts` | Versioned, bounded and atomic persistence of non-credential UI preferences |
| `src/window-state.ts` | Persist/restore window bounds (`userData/window-state.json`) |
| `src/menu.ts` | Application menu (standard macOS roles; none in packaged win/linux) |
| `src/oauth-window.ts` | OAuth window that intercepts the Pixiv callback → returns the code |
| `src/preload.ts` | `contextBridge` → `window.pixivbiu` (the SPA mirrors this in `frontend/src/lib/desktop.ts`) |
| `src/updater.ts` | `electron-updater` wiring + IPC to the renderer |
| `src/update-controller.ts` | Sequenced snapshots, download/install single flights and shutdown coordination |
| `src/update-store.ts` | Atomic cache index, SHA-512 verification and next-launch installation receipts |
| `src/update-types.ts` | Main/preload update contract and safe error categories |
| `src/release-notes.ts` | Pure helpers stitching changelogs across skipped versions |
| `electron-builder.yml` | Packaging / signing / publish config |
| `build/icon.icns` / `icon.png` | macOS bundle icon and Linux/runtime icon, generated from the Unix artwork |
| `build/icon.ico` | Multi-size Windows executable, installer, and runtime icon |
| `build/after-pack.cjs` | Checks package contents before signing and removes unused macOS hardware-permission declarations |
| `build/package-audit.cjs` / `package-report.cjs` | Validates payload, languages and core architecture; reports final app and artifact sizes |
| `build/entitlements.mac.plist` | Hardened-runtime entitlements |
| `resources/<arch>/` | The Go core binary per arch (`x64` / `arm64`), staged at build time (gitignored) |

## Window & chrome

The shell retains native window controls; the SPA accounts for their space according to the actual platform chrome (`src/window-chrome.ts`):

- **macOS**: `titleBarStyle: hiddenInset`; traffic lights float over the sidebar (`trafficLightPosition`). The window uses `vibrancy: "sidebar"` with a fully transparent `backgroundColor`, so the splash is full-window frost and, once loaded, the sidebar/activity rail stay frosted while the content area paints opaque.
- **Windows 11 (22H2+)**: `titleBarStyle: hidden` + `titleBarOverlay` (transparent caption-button strip, 36px) + `backgroundMaterial: "mica"`. A compact SPA title bar blends with the sidebar material and reserves a full-width row above all application content. In the main layout, the sidebar has no top separator; a 1px border follows the main surface's rounded upper-left corner and continues across the activity panel/rail, tracking sidebar resizing. Other routes retain the title bar's full-width bottom separator. Borders use the SPA's border color and stay inside their allocated heights. Older Windows falls back to a solid surface-colored window with a solid overlay.
- **Linux**: native frame, solid background (frameless/transparent windows are unreliable across compositors).

On Windows, `WindowLayout` reserves `--window-content-top`, using Chromium's `env(titlebar-area-y)` plus `env(titlebar-area-height)` with a 36 CSS-pixel minimum matching `WCO_HEIGHT`. This minimum also protects first paint and unavailable/zero geometry; zoomed-in content may retain a taller row than the native buttons. The title text uses `env(titlebar-area-x)` / `env(titlebar-area-width)` and stays hidden if horizontal geometry is unavailable, so no caption-button width is guessed. Both the title bar and the main sidebar's empty space are draggable; `data-window-sidebar` explicitly opts the sidebar into `app-drag` on Windows, with local exceptions for its navigation/account controls. The activity rail remains ordinary Windows content. Native controls own minimize, maximize, close and window-system interactions.

On macOS, the SPA retains the 44px invisible top drag band at negative z-index and sidebar-only traffic-light padding; no extra toolbar row or page padding is added. Sidebar/activity-rail empty space remains draggable. Interactive elements opt out only within chrome/control scopes (`app-drag`, semantic headers/forms/navigation/toolbars/tab lists, and `data-app-controls`); on Windows the automatic control scope is restricted to `data-window-sidebar`. Custom widgets can use `data-app-no-drag` or `app-no-drag` on either platform. Shared popup surfaces, modal backdrops, scrollbars and resize handles also opt out on both platforms so they remain interactive over draggable sidebars. Ordinary artwork cards and links do not declare a window region: Electron can subtract a scrolled `no-drag` rectangle even when overflow has clipped its paint, causing invisible content to disable title-bar dragging. Do not restore a global interactive-element rule or reset all content to explicit `app-region: none`. Browser and Linux builds have no SPA title-bar row or drag regions. Fullscreen disables the SPA drag surfaces and exceptions and removes title-bar/traffic-light spacing.

`windowChrome.read()` and `windowChrome.onState()` expose only `{ fullscreen }`. The main process combines native and HTML fullscreen, publishes after page load and state changes, and checks the trusted main frame for reads. The SPA subscribes before its initial read and ignores a stale snapshot after an event. HTML fullscreen also has a renderer-side fallback; missing bridge/geometry information conservatively keeps normal spacing. Authored startup/failure data documents share the shell's title-bar height and consume notifications through preload, but cannot invoke the core-origin read IPC.

The content viewport fills the space below the title bar; route roots use parent height. Windows dialog portals are centered and bounded within that viewport. Floating menus, popovers, selects and tooltips receive its measured rectangle as their collision boundary, updated on resize/fullscreen/zoom; item-aligned selects use anchored positioning while a top inset is present. Keep the actual page scroller at `[data-app-scroller]`. The [frontend guide](../frontend/README.md#desktop-integration) owns these component conventions.

The SPA learns what the shell actually did via `platform.frameless` / `platform.frost` on the preload bridge (wired through `webPreferences.additionalArguments` as `--pixivbiu-frameless` / `--pixivbiu-frost`), and only then draws the matching chrome and translucent surfaces. Missing flags mean framed/opaque. A newer SPA can reserve space under an older WCO shell without the optional fullscreen bridge, but an older embedded SPA cannot acquire this layout fix from a shell update alone: release the updated core and advance `.core-version` before shipping Desktop.

Window size/position persist in `userData/window-state.json` (`src/window-state.ts`; default 1440×900, validated against the current displays on restore). On macOS, closing the window keeps the app and the core sidecar alive in the Dock (downloads keep running); clicking the Dock icon reopens the window against the same core, and only Cmd+Q quits.

## Develop

```bash
# From the repo root: build the core (embeds the SPA) so the shell has it.
make dist                              # -> bin/pixivbiu (.exe on Windows)

cd desktop
npm ci
npm start                                # tsc -> electron .
```

`npm run check` builds the shell and runs release/security contracts plus real subprocess lifecycle tests (including parent death, port conflicts and forced termination); `npm run typecheck` checks types without emitting. `npm run test:native` runs an isolated Electron smoke fixture (requires frontend dependencies) covering memory sessions, the protocol proxy, sandboxed preload, preference persistence and window recreation. `PIXIVBIU_SMOKE_CORE_BIN=/absolute/path/to/bin/pixivbiu npm run test:native-core` runs Electron against a freshly built host core in a temporary profile with synthetic auth and external traffic directed to a closed local proxy; it checks two real settings restarts, the stable protocol, SSE drain, failure-page navigation and core shutdown. Use the `.exe` path on Windows. Real Pixiv OAuth, signed-package keychain behavior, window chrome and Windows console visibility still require manual native validation. The root `make desktop-dev` convenience target currently uses `npm install`; the manual sequence above uses the lockfile strictly.

After `cd frontend && bun run build`, run `npm run test:native-chrome` in `desktop`. This uses the built SPA, synthetic local API/artwork, temporary profile and production preload/tracker to check Filter/search pointer clicks, remaining content height, viewer/dialog bounds, login layout, zoom and fullscreen state. On Windows, the read-only `windows-window-hit-test.ps1` helper checks native `WM_NCHITTEST` results over real scrolled artwork and its fallback, search controls and dialogs, accounting for window DPI and renderer zoom. It also tests the macOS CSS layout in a frameless Windows fixture; this is not native macOS validation. The suite exercises real host fullscreen transitions and simulated Windows/macOS/Linux/browser/old-shell layout branches. Before release, manually check Windows 10/11 normal/maximized/restored windows, 100/125/150/200% display scaling, mixed-DPI monitor moves, title-bar double-click/right-click, native caption buttons and Windows 11 Snap. Also check menus near the top edge, panel resizing, tall dialogs, keyboard focus, high contrast, and Linux GNOME/KDE under Wayland/X11. On macOS, scroll artwork under the top band and verify window movement, search/filter/settings input, traffic-light clearance and sidebar interactions; simulated input does not prove native window movement.

For a focused drag regression, use `npm run test:native-chrome -- --drag-only`. It covers sidebar empty-space dragging, navigation/account input, menus and modal backdrops over the sidebar, artwork/fallback native hit tests at 100% and 150% renderer zoom on Windows, search focus, platform layout gates and the fullscreen CSS contract without running the separate viewport/real-fullscreen scenarios. The default command still runs those scenarios; passing the focused option is not evidence that native fullscreen or the full suite passed.

In dev the shell looks for the core at `../bin/pixivbiu` (override with `PIXIVBIU_CORE_BIN`). The shell owns OS placement and passes it to the (portable) core via env, so data lands in OS-appropriate dirs, not the repo:

| Data | Location | Env |
|------|----------|-----|
| settings / auth state / download index | `userData/usr/` | `PIXIVBIU_DATA_DIR` |
| image cache (purgeable) | OS cache dir (`~/Library/Caches/PixivBiu`, …) | `PIXIVBIU_CACHE_DIR` |
| logs (rotating) | OS logs dir (`app.getPath('logs')/pixivbiu.log`) | `PIXIVBIU_LOG_FILE` |
| downloads | `~/Downloads/PixivBiu` (first-run seed) | `download.output_dir` |

The download default is seeded only when the settings file is absent and stays editable in Settings (`core-process.ts::seedFirstRunDefaults`). If the Downloads directory cannot be resolved or seeding fails, the core uses its normal default. Business logs go to the configured rotating file. Managed mode suppresses the portable startup banner (which includes account/proxy details); the handshake goes to stdout, while early failures and panic output are captured from stderr into a bounded local diagnostic snapshot.

### Managed lifecycle protocol

The shell passes `-desktop-managed=1`; a compatible core emits `pixivbiu-desktop/1` as its first stdout line, followed by `pixivbiu-desktop/1 ready` only after binding its listener. Health polling starts after both messages, so a competing listener cannot satisfy startup readiness. This is an internal capability marker, not a secret or authentication mechanism. Both the runtime handshake and packaging's embedded-marker check must pass. Old cores are refused rather than silently reverting to unsupervised Windows re-exec. No additional HTTP endpoints or renderer bridge methods are introduced. Portable CLI/Docker executions omit this argument and keep their existing lifecycle.

All core launches use `windowsHide: true`, direct executable invocation (`shell: false`, `detached: false`) and pipes for all standard streams. The main process continually drains stdout/stderr; `core-startup.log` keeps at most the last 64 KiB for the current shell run, coalesced into atomic snapshots at most once per 250 ms during normal output. A failed log write retains the memory tail and does not block pipe consumption. The core's existing rotating `pixivbiu.log` remains the business-log destination. Diagnostics are local, may contain private error details, and must be redacted before sharing.

Stdin is a private parent-lifetime pipe. `stop\n`, EOF or a read error requests normal shutdown: SSE closes, HTTP drains and workers persist/clean up state. The shell waits up to 10 seconds, then uses hidden `System32/taskkill.exe /PID <pid> /T /F` on Windows (with error/exit handling and a direct-kill fallback), or SIGKILL elsewhere, with bounded termination waits. Windows/Linux keep the main window until cleanup completes; macOS window dismissal still keeps the core running. A failed termination keeps the app open and allows another close attempt. Quit cancels pending readiness, forbids new launches and waits for the current child; a failed attempt is cleaned up before retry. Parent death closes the pipe so the core also shuts down when no Electron quit handler can run. Forced OS termination cannot guarantee graceful state persistence; durable download recovery remains the fallback, not partial-byte resume.

For settings restart, the managed core drains and completes worker cleanup, then exits with code 75 instead of creating its own successor. The shell clears the old port and starts a new managed child, keeping the SPA mounted so REST/SSE reconnect through the same `pixivbiu://core` origin. Only a healthy managed child exiting with this code requests restart; ordinary crashes require an explicit retry. Code 76 identifies a startup port conflict. Stopping the application takes precedence over a simultaneous restart.

The same shutdown barrier runs before explicit updater installation: electron-updater can launch the Windows installer before Electron's `before-quit`. If installer startup fails while the shell is still alive, the shell resumes the core. Normal quit and system shutdown never install an update; a pending explicit update is cancelled when ordinary quit takes ownership of the barrier. Failure-page actions are intercepted in the main process only from the exact current failure document and only for fixed retry/log destinations; they do not grant data documents access to privileged IPC.

## Desktop updates

Updates have two explicit actions: **Download update**, then **Restart & update**. Both `autoDownload` and `autoInstallOnAppQuit` are false. Downloading and the downloaded state leave the core running, and progress does not block browsing. Only preparing/installing shows the global waiting layer. About and release notes share the same operation state. Desktop version comes from `app.getVersion()`; the embedded core's version is displayed separately. Browser builds retain the core update API.

On packaged Windows, the shell sets NsisUpdater's public `installDirectory` to the directory containing the currently running executable. Real consecutive NSIS upgrades exposed a second-upgrade fallback to the default Programs directory while the custom directory retained the previous version. Passing the actual executable directory keeps successive upgrades in the user's existing location, including paths with spaces; first-install scope, directory selection and Windows elevation behavior remain owned by NSIS.

| Installed format | Apply behavior |
| --- | --- |
| Windows NSIS | `quitAndInstall(true, true)`: silent install and reopen; necessary UAC still belongs to Windows. First installation retains the directory chooser and existing install scope. |
| macOS | Native update installation and reopen, using the updater's cached ZIP. |
| Linux AppImage | Replace and reopen through electron-updater, after checking that the current AppImage and its directory are writable. |
| Linux deb/rpm | Notify and show release notes, a corresponding package download and upgrade instructions. Apply with the system package installer/manager, then reopen. Main refuses in-app download/install; the project does not supply an apt/yum repository. |

The main process owns snapshots with an increasing sequence, current Desktop version, format/capability, target version, progress, last successful check, safe error category and readiness. `updates.read()`, `check()`, `download()` and `restartAndInstall()` retain trusted-window/main-frame checks. The frontend subscribes before reading and rejects stale sequences, including delayed reads after a reload. Legacy `downloadAndInstall()` combines both operations for older embedded UIs; a newer UI feature-detects the three new methods to support older shells. Checks, downloads and installations each coalesce duplicate requests; late events/notes cannot regress another operation's state.

Before restarting, the frontend re-reads the queued/running artwork count from REST. A non-empty queue or unavailable/invalid response requires application-dialog confirmation: interrupted tasks are requeued, and the current file may download again because byte-range resume is not supported. Cache verification and library cache preparation happen before stopping the core. The shared shutdown barrier waits for process cleanup before starting the installer. Download, verification or barrier errors release the UI; an installer error emitted while the process remains alive restores the core. An OS installer may outlive the shell, so later failures are diagnosed on the next launch and offer the official package for repair; no automatic rollback is promised.

`userData/update-state.json` is a versioned, atomically replaced main-private cache index and installation receipt. Download completion records the event's actual cached path, version, format and SHA-512, including macOS where `downloadUpdate()` can return an empty array. Startup must obtain a fresh eligible offer from the configured feed and hash the entire file before restoring downloaded readiness. Missing/tampered cache, a changed or withdrawn offer and offline startup never enable installation or automatically redownload. A later explicit download may fetch again. Persisted paths are never executed; installation always uses electron-updater's public API after rehydrating its cache. A receipt is successful only if the next launch runs the exact target Desktop version.

Detailed errors stay in `app.getPath("logs")/desktop-update.log`, a 64 KiB bounded local snapshot with credentials and URL queries removed; renderer errors are localized categories. Raw diagnostics never cross the bridge. Existing core/preference/login paths are preserved across updates.

After an installer handoff fails while the shell is alive, `installRecoveryRequired` prevents another installation attempt in that process: the public library APIs cannot reliably reset Windows' quit flag or native macOS callbacks. Core resumes, the waiting layer closes, and the official installer remains available. Reopen PixivBiu for a fresh updater session before retrying. Download and verification failures can retry without reopening. If Core cannot be stopped, main keeps ownership of the existing child and shows its retry/log failure page; it never spawns a second Core beside an unconfirmed live process.

Run `npm run check` for state, cache, failure, quit-race, unauthorized IPC and compatibility tests. After `bun run build` in `frontend`, run `npm run test:native-updates` for the production SPA/preload in isolated Electron windows with synthetic APIs and no installer/account data. It covers background browsing, navigation/reload recovery, task/unknown-status confirmation, retry, package-manager capability, four locales and keyboard consent. It does not prove native installation: rehearse two successive releases on Windows 10/11 (user/machine scope, custom directory, UAC acceptance/cancellation), both macOS architectures and writable/read-only AppImage locations. Verify reopen, requeued tasks and preserved configuration/login. From a client predating this fix, the first upgrade may show the installer wizard once; the new flow starts when the fixed shell runs.

### Isolated Windows installer E2E

From the repository root, with the locked Desktop dependencies and a built frontend available, run:

```powershell
npm.cmd run build --prefix desktop
New-Item -ItemType Directory -Force desktop/out/update-e2e | Out-Null
go build -o desktop/out/update-e2e/pixivbiu.exe ./cmd/server
node scripts/desktop-install-e2e.cjs
```

This native Windows test packages three unsigned NSIS fixtures (`0.0.1` → `0.0.2` → `0.0.3`) using the current production `UpdateController`, `UpdateStore`, `CoreSupervisor` and Windows installation-directory helper, a real locally built Go Core, and the locked Electron/electron-updater dependencies. Each run owns its app ID/GUID, product/executable/package names, installation directory, userData, LOCALAPPDATA/cache, NSIS installer store, loopback update feed and synthetic session; it creates no shortcuts, installs explicitly for the current user, and invokes its own uninstaller on completion. Cleanup verifies fixture ownership before stopping processes/uninstalling and validates the cached NSIS installer's bytes before removal. Installer and command waits have deadlines. First-time packaging may download electron-builder's NSIS tools. It does not change the production update feed, Core pin or package versions.

Assertions cover actual feed download and SHA512 cache verification, a healthy unchanged Core PID during downloads, ordinary exit without installation, reopening and revalidating a cached offer, both real silent installer handoffs and automatic relaunches in the same custom directory containing spaces, actual Windows executable FileVersion/ProductVersion and executable/ASAR SHA256 changes, successful installation receipts, persisted settings read back through REST, synthetic authenticated session recovery, and shutdown without old shell/Core processes. Evidence is saved under `desktop/out/update-e2e/<run>/` in `result.json`, `events.jsonl`, `feed-requests.jsonl`, `compiled-identities.jsonl`, `registry.jsonl`, `second-upgrade-paths.json` and `cleanup.json`, alongside the installers. The three-version test passed on Windows 11 Pro 10.0.26300 x64 after the installation-directory fix; it previously reproduced the custom-directory fallback.

The installer fixture has its own main entry and command transport; it does not exercise the production main window, SPA, preload or trusted IPC. Combine it with `test:native-updates` and `test:native-core` for those complementary checks. It disables NSIS elevation, so it does not cover machine installations, UAC consent/cancellation, signing/SmartScreen, actual Pixiv OAuth, download-job recovery, macOS or Linux installation. Native results from one Windows host do not establish Windows 10 behavior.

The [validation record](UPDATE_VALIDATION.md) preserves the tested scope, outcomes and installed-byte hashes after cleaning the task's temporary packages and caches.

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

The desktop app is its **own** release train (`desktop-v*` tag), decoupled from the core `v*` train. CI (`.github/workflows/desktop.yml`) does not rebuild the core — it downloads the core release pinned in [`.core-version`](.core-version) and bundles that exact binary. Bump `.core-version` (+ cut a new `desktop-v*` tag) to ship a newer core to desktop users. This shell requires lifecycle protocol v1: release a core containing `cmd/server/desktop.go` and update the pin before the next desktop release. Pins predating this protocol are rejected by the package audit; use a published compatible release. Full flow + secrets in [../docs/RELEASE.md](../docs/RELEASE.md#desktop-release-train).

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

The locally built core uses `dev-<commit>` regardless of tags; pass `VERSION=v3.1.0` to `make desktop-dist` only when intentionally rehearsing that core version. This does not change the shell version from `package.json`.

Alternatively, reproduce CI's pinned-core staging path (needs authenticated `gh`). This downloads/extracts the release archive; the staging script does not currently perform the core updater's checksum/minisign verification. On macOS `stage-core.sh` stages **both** arch slices, so a plain `npm run dist` packages both x64 and arm64:

```bash
make desktop-fetch-core                 # -> resources/x64/ (+ resources/arm64/ on macOS)
cd desktop && npm ci && npm run dist
```

### Package footprint and verification

The app ships Electron resources for English, Simplified Chinese, Traditional Chinese and Japanese via `electronLanguages`, including matching regional/gender variants. Other system languages use available fallback text for Electron/Chromium UI, usually English; OS-native dialogs may still use the system language. This does not remove website translations, fonts, input methods, ICU data or the ability to display other languages. The SPA keeps its four existing translations. Validate unsupported-system-language startup and Pixiv OAuth/captcha language negotiation with native packages.

Shell builds clear previous `dist` output first. ASAR contains compiled shell JavaScript, package metadata and automatically collected production dependencies, with source maps/TypeScript excluded and dependency license notices retained. The matching core is bundled once through `extraResources`. Keep Chromium binaries, GPU fallbacks, ICU, runtime licenses and normal compression. Most package bytes belong to Electron; ASAR is a container, not an additional compression layer.

Packaging hooks check locales, application/preload entries, declared production dependency entries, runtime licenses and the core's platform/architecture and managed-protocol marker before signing. They also compare the bundled core with the staged bytes at that point; signing can legitimately change the executable afterwards. After artifacts finish, the hooks recheck the final app and write `<output>/size-reports/<platform>-<arch>.json` plus `summary.md`, including Desktop/Electron versions, core hashes, pin and artifact sizes. `coreReleaseVersion` is supplied by CI's `CORE_VERSION`; local builds without it are explicitly unverified, even when a pin exists. `--dir` builds report an empty artifact list. Reports stay in Actions artifacts and the job summary, not the release/update feed; an audit failure blocks publication of the draft.

The ASAR audit uses POSIX paths internally for payload rules and dependency resolution, converting to host-native separators when reading archived manifests. Release configuration checks accept both LF and CRLF checkouts so the same contracts run on Linux and Windows.

Size reports use bytes and MiB (1 MiB = 1,048,576 bytes). Expanded size sums regular file lengths without following framework symlinks; it is not filesystem allocation or a sum of every installer format. Compare builds with identical Electron/core/lockfiles, architecture, target formats and signing settings. Structural checks prevent leaked payload and missing files; there is no arbitrary total-size cap. `npm run check` also runs build-cleanup and package-audit regression tests. On packaging changes, verify native startup in all four languages and an unsupported system language, OAuth/captcha, image loading, downloads/SSE, quit, and an older installation's update path. Validate macOS signatures/notarization separately; cross-packaging cannot prove native behavior.

### Signing / notarization (macOS)

`mac.notarize: true` + `hardenedRuntime: true` require these env vars at pack time:

- `CSC_LINK` / `CSC_KEY_PASSWORD` — Developer ID Application cert (.p12)
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` — notarization

macOS ships a **per-arch split** (arm64 + x64), avoiding a universal download containing both core and Electron CPU slices. Actual sizes depend on the runtime and core release; use the package size reports rather than fixed estimates. Both arches build in one `electron-builder` run and share one `latest-mac.yml`; the updater picks the slice matching `process.arch`. The embedded Go executable is included in app signing. Verify the packaged app with its actual path:

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
