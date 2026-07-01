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
- **Whole-app updates** via `electron-updater` (the core's own self-updater is
  disabled in desktop builds). See `src/updater.ts`.

## Layout

| File | Responsibility |
|------|----------------|
| `src/main.ts` | App lifecycle; orchestrates core + window + updater; IPC handlers |
| `src/core-process.ts` | Free-port pick, spawn the Go binary, `/health` readiness, kill-on-quit |
| `src/oauth-window.ts` | OAuth window that intercepts the Pixiv callback → returns the code |
| `src/preload.ts` | `contextBridge` → `window.pixivbiu` (the SPA mirrors this in `frontend/src/lib/desktop.ts`) |
| `src/updater.ts` | `electron-updater` wiring + IPC to the renderer |
| `electron-builder.yml` | Packaging / signing / publish config |
| `build/entitlements.mac.plist` | Hardened-runtime entitlements |
| `resources/` | The Go core binary, staged at build time (gitignored) |

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

CI (`.github/workflows/desktop.yml`) builds per-platform on a tag. Locally:

```bash
# Stage the host-platform core binary first:
make build-web && make build
cp ../bin/pixivbiu resources/            # or pixivbiu.exe on Windows

cd desktop && npm install && npm run dist
```

### Signing / notarization (macOS)

`mac.notarize: true` + `hardenedRuntime: true` require these env vars at pack time:

- `CSC_LINK` / `CSC_KEY_PASSWORD` — Developer ID Application cert (.p12)
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` — notarization

The embedded Go binary under `Contents/Resources` is signed as part of the app's
deep signing. Verify with `codesign --verify --deep --strict` and
`spctl -a -vvv <App>.app`.

Windows/Linux ship unsigned in v1; add a Windows cert later via
`win.signtoolOptions`.

### Icons

Drop `build/icon.icns`, `build/icon.ico`, `build/icon.png` (electron-builder
auto-detects them). Generate them from the project's app artwork — the core no
longer ships a Windows `.exe` icon, so the desktop app owns all icon assets.
