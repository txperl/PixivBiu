# PixivBiu Desktop (Electron)

A thin Electron shell around the single-binary PixivBiu core. The Go binary is
unchanged: the shell spawns it as a child ("sidecar"), waits for `/health`, then
loads its embedded SPA from `http://127.0.0.1:<port>`.

What the shell adds:

- **Automated Pixiv login.** Instead of copying the OAuth callback URL out of
  DevTools, a Chromium window opens Pixiv's hosted login and intercepts the
  `…/auth/pixiv/callback?code=…` redirect automatically (captcha / 2FA render
  natively). The captured code goes straight into the existing
  `POST /auth/oauth/exchange`. See `src/oauth-window.ts`.
- **Whole-app updates** via `electron-updater`, off the dedicated
  [PixivBiu-Desktop](https://github.com/txperl/PixivBiu-Desktop) GitHub
  Releases repo (`github` provider) — the core's own self-updater is
  disabled in desktop builds. See `src/updater.ts` and [../docs/RELEASE.md](../docs/RELEASE.md#desktop-release-train).

## Layout

| File | Responsibility |
|------|----------------|
| `src/main.ts` | App lifecycle; orchestrates core + window + updater; IPC handlers |
| `src/core-process.ts` | Free-port pick, spawn the Go binary, `/health` readiness, kill-on-quit |
| `src/window-chrome.ts` | Per-platform frameless title bar + frosted backdrop options |
| `src/window-state.ts` | Persist/restore window bounds (`userData/window-state.json`) |
| `src/menu.ts` | Application menu (standard macOS roles; none in packaged win/linux) |
| `src/oauth-window.ts` | OAuth window that intercepts the Pixiv callback → returns the code |
| `src/preload.ts` | `contextBridge` → `window.pixivbiu` (the SPA mirrors this in `frontend/src/lib/desktop.ts`) |
| `src/updater.ts` | `electron-updater` wiring + IPC to the renderer |
| `electron-builder.yml` | Packaging / signing / publish config |
| `build/entitlements.mac.plist` | Hardened-runtime entitlements |
| `resources/<arch>/` | The Go core binary per arch (`x64` / `arm64`), staged at build time (gitignored) |

## Window & chrome

The shell draws no separate title bar — the SPA is the whole window
(`src/window-chrome.ts`):

- **macOS**: `titleBarStyle: hiddenInset`; traffic lights float over the
  sidebar (`trafficLightPosition`). The window uses `vibrancy: "sidebar"` with
  a fully transparent `backgroundColor`, so the splash is full-window frost
  and, once loaded, the sidebar/activity rail stay frosted while the content
  area paints opaque.
- **Windows 11 (22H2+)**: `titleBarStyle: hidden` + `titleBarOverlay`
  (transparent caption-button strip, 36px) + `backgroundMaterial: "mica"`.
  Older Windows falls back to a solid surface-colored window with a solid
  overlay.
- **Linux**: native frame, solid background (frameless/transparent windows are
  unreliable across compositors).

Dragging: the SPA paints a full-width invisible drag band across the top of
the window (`--titlebar-inset`: 44px on macOS, `env(titlebar-area-height)` on
Windows) at negative z-index, and a global CSS rule marks every interactive
element `app-region: no-drag`. Chromium computes drag regions in paint order,
so the band drags from any empty top pixel while buttons/inputs painted over
it stay clickable — no layout shift, no title-bar row. The sidebar and the
right activity rail are drag surfaces too (native macOS sidebar behavior);
their nav links/buttons punch holes the same way. Custom widgets the selector
list misses can opt out with `data-app-no-drag`.

The SPA learns what the shell actually did via `platform.frameless` /
`platform.frost` on the preload bridge (wired through
`webPreferences.additionalArguments` as `--pixivbiu-frameless` /
`--pixivbiu-frost`), and only then draws drag regions (`app-drag` utilities)
and translucent surfaces. Cross-version combinations degrade gracefully: a new
shell with an older core renders frameless but opaque; an old shell with a
newer core renders exactly as before.

Window size/position persist in `userData/window-state.json`
(`src/window-state.ts`; default 1440×900, validated against the current
displays on restore). On macOS, closing the window keeps the app and the core
sidecar alive in the Dock (downloads keep running); clicking the Dock icon
reopens the window against the same core, and only Cmd+Q quits.

## Develop

```bash
# From the repo root: build the core (embeds the SPA) so the shell has it.
make build-web && make build            # -> bin/pixivbiu

cd desktop
npm install
npm start                                # tsc -> electron .
```

In dev the shell looks for the core at `../bin/pixivbiu` (override with
`PIXIVBIU_CORE_BIN`). The shell owns OS placement and passes it to the (portable)
core via env, so data lands in OS-appropriate dirs, not the repo:

| Data | Location | Env |
|------|----------|-----|
| settings / auth state / download index | `userData/usr/` | `PIXIVBIU_DATA_DIR` |
| image cache (purgeable) | OS cache dir (`~/Library/Caches/PixivBiu`, …) | `PIXIVBIU_CACHE_DIR` |
| logs (rotating) | OS logs dir (`app.getPath('logs')/pixivbiu.log`) | `PIXIVBIU_LOG_FILE` |
| downloads | `~/Downloads/PixivBiu` (first-run seed) | `download.output_dir` |

The download default is seeded on first run only and stays editable in Settings
(`core-process.ts::seedFirstRunDefaults`).

## Package

The desktop app is its **own** release train (`desktop-v*` tag), decoupled from the
core `v*` train. CI (`.github/workflows/desktop.yml`) does not rebuild the core — it
downloads the core release pinned in [`.core-version`](.core-version) and bundles that
exact binary. Bump `.core-version` (+ cut a new `desktop-v*` tag) to ship a newer core
to desktop users. Full flow + secrets in [../docs/RELEASE.md](../docs/RELEASE.md#desktop-release-train).

Packaging is **per-arch** (`resources/<arch>/pixivbiu`): macOS ships separate
arm64 + x64 builds (not a universal binary — see Signing below); Windows/Linux are
x64. For fast local iteration, `make desktop-dist` builds the working-tree core and
packages **the host arch only** (it stages that one core and passes
`--<host-arch>` to electron-builder, which otherwise builds both macOS arches):

```bash
make desktop-dist                       # stage host-arch core -> electron-builder --<host-arch>
```

…or reproduce CI exactly by staging the pinned, already-released core (needs `gh`).
On macOS `stage-core.sh` stages **both** arch slices, so a plain `npm run dist`
packages both x64 and arm64:

```bash
make desktop-fetch-core                 # -> resources/x64/ (+ resources/arm64/ on macOS)
cd desktop && npm install && npm run dist
```

### Signing / notarization (macOS)

`mac.notarize: true` + `hardenedRuntime: true` require these env vars at pack time:

- `CSC_LINK` / `CSC_KEY_PASSWORD` — Developer ID Application cert (.p12)
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` — notarization

macOS ships a **per-arch split** (arm64 + x64), not a universal binary: universal
would double the bundled ~85 MB Go core (plus the Electron runtime), so ~45% of a
universal download is CPU code the user can't run. Both arches build in one
`electron-builder` run and share one `latest-mac.yml`; the updater picks the slice
matching `process.arch`. The embedded Go binary under `Contents/Resources` is
signed as part of the app's deep signing. Verify with
`codesign --verify --deep --strict` and `spctl -a -vvv <App>.app`.

### Signing (Windows)

Windows uses **Azure Trusted Signing** (cloud, EV-grade SmartScreen reputation, no
hardware token). It's kept out of `electron-builder.yml` so an unprovisioned build
still succeeds unsigned; CI injects `-c.win.azureSignOptions.*` from the
`WIN_AZURE_*` repo vars (auth via `AZURE_TENANT_ID`/`_CLIENT_ID`/`_CLIENT_SECRET`
secrets) only when `WIN_AZURE_ENDPOINT` is set. See
[../docs/RELEASE.md](../docs/RELEASE.md#secrets--variables-desktop). Linux ships
unsigned.

### Icons

Drop `build/icon.icns`, `build/icon.ico`, `build/icon.png` (electron-builder
auto-detects them). Generate them from the project's app artwork — the core no
longer ships a Windows `.exe` icon, so the desktop app owns all icon assets.
