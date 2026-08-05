import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { app } from "electron";

// The PixivBiu core is the existing single Go binary. The desktop shell runs it
// as a child ("sidecar"): it serves the embedded SPA + REST API on a loopback
// port, and the pixivbiu:// protocol handler (core-protocol.ts) proxies the
// window to it. Keeping the core untouched is the whole point — every knob we
// set here is a pre-existing flag/env var. The core never computes OS paths
// itself (it stays portable); the shell owns OS placement and passes it in.

// No loopback URL in the handle on purpose: the port changes every launch and
// web storage is keyed by origin including the port, so the renderer must only
// ever load CORE_BASE_URL — the protocol handler dereferences `port` per
// request (a future respawn on a new port is picked up automatically).
export type CoreHandle = {
    child: ChildProcess;
    port: number;
};

// How long to wait for the core to bind + answer /health before giving up on
// one spawn attempt. Boot is normally well under a second on localhost.
const HEALTH_TIMEOUT_MS = 20_000;
// A fresh free port is picked per attempt, so a lost bind race just retries.
const SPAWN_ATTEMPTS = 3;

function coreBinaryName(): string {
    return process.platform === "win32" ? "pixivbiu.exe" : "pixivbiu";
}

// coreBinaryPath resolves where the Go binary lives. In a packaged app it is
// copied into the app's resources (electron-builder `extraResources`); in dev
// it defaults to the repo's `make build` output, overridable via env.
function coreBinaryPath(): string {
    const name = coreBinaryName();
    if (app.isPackaged) {
        return path.join(process.resourcesPath, name);
    }
    return process.env.PIXIVBIU_CORE_BIN || path.join(__dirname, "..", "..", "bin", name);
}

// findFreePort asks the OS for an ephemeral port and immediately releases it.
// There is a small TOCTOU window before the core binds it; startCore guards
// that by retrying with a new port if the child exits before becoming healthy.
function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const addr = srv.address();
            if (addr && typeof addr === "object") {
                const { port } = addr;
                srv.close(() => resolve(port));
            } else {
                srv.close(() => reject(new Error("could not determine a free port")));
            }
        });
    });
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// seedFirstRunDefaults gives desktop users a sensible default download folder.
//
// With PIXIVBIU_DATA_DIR=userData, the core anchors relative runtime paths —
// including a relative download.output_dir (default "./downloads") — to that
// root, so out of the box downloads would land in a hidden app-data folder. On
// first run only, seed download.output_dir to the OS Downloads folder.
//
// We write the settings file directly rather than PATCH /config: that endpoint
// is auth-gated and first run is pre-login. The on-disk shape is plain nested
// JSON keyed by koanf names (internal/config/store.go); this is the user-override
// layer, so it stays fully editable in Settings and later PATCHes preserve it.
function seedFirstRunDefaults(): void {
    // Mirrors the core's default -config path, anchored to PIXIVBIU_DATA_DIR.
    const settingsPath = path.join(app.getPath("userData"), "usr", "settings.json");
    if (fs.existsSync(settingsPath)) return; // not first run — never clobber user settings

    let downloadsDir: string;
    try {
        downloadsDir = path.join(app.getPath("downloads"), "PixivBiu");
    } catch {
        return; // no OS Downloads dir (rare headless case) — let the core use its default
    }

    try {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
        const seed = { download: { output_dir: downloadsDir } };
        fs.writeFileSync(settingsPath, `${JSON.stringify(seed, null, 2)}\n`, { mode: 0o600 });
    } catch {
        // Non-fatal: the core falls back to ./downloads under the data dir.
    }
}

// osCacheDir computes the OS cache directory for purgeable, machine-local data.
// Electron's app.getPath has no "cache" entry, so derive it per-platform — this
// is the desktop owning OS placement (the core stays portable/neutral). Keeps
// the core's up-to-2 GiB regenerable image cache out of the backed-up (macOS) /
// roaming (Windows) app-data dir that PIXIVBIU_DATA_DIR points at.
function osCacheDir(): string {
    const name = app.getName();
    if (process.platform === "darwin") {
        return path.join(app.getPath("home"), "Library", "Caches", name);
    }
    if (process.platform === "win32") {
        return path.join(process.env.LOCALAPPDATA || app.getPath("temp"), name, "Cache");
    }
    return path.join(process.env.XDG_CACHE_HOME || path.join(app.getPath("home"), ".cache"), name);
}

// waitForHealth polls the core's /health endpoint until it answers 200, the
// deadline passes, or the child process exits (signalled via `aborted`).
async function waitForHealth(port: number, aborted: () => boolean): Promise<void> {
    const url = `http://127.0.0.1:${port}/api/v1/health`;
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (aborted()) throw new Error("core process exited before becoming ready");
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
            if (res.ok) return;
        } catch {
            // Not listening yet — keep polling until the deadline.
        }
        await delay(150);
    }
    throw new Error("core did not become healthy in time");
}

export async function startCore(): Promise<CoreHandle> {
    seedFirstRunDefaults();
    const bin = coreBinaryPath();
    // OS-derived paths are loop-invariant — compute them once, not per retry.
    const dataDir = app.getPath("userData");
    const cacheDir = osCacheDir();
    const logFile = path.join(app.getPath("logs"), "pixivbiu.log");
    let lastErr: unknown;

    for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
        const port = await findFreePort();
        const child = spawn(bin, [], {
            env: {
                ...process.env,
                // Relocate runtime state (settings, auth state, download index,
                // default downloads) outside the read-only app bundle.
                PIXIVBIU_DATA_DIR: dataDir,
                // Carve the purgeable image cache out of the app-data dir into
                // the OS cache dir, so a large regenerable cache isn't backed up
                // (macOS Time Machine) or roamed (Windows %APPDATA%).
                PIXIVBIU_CACHE_DIR: cacheDir,
                // A packaged app has no visible stdout; tee the core's slog to a
                // rotating file in the OS logs dir so it stays diagnosable.
                PIXIVBIU_LOG_FILE: logFile,
                // The shell owns the window — never auto-open the OS browser.
                PIXIVBIU_APP_OPEN_BROWSER: "false",
                // Pin to loopback (don't inherit an ambient PIXIVBIU_SERVER_HOST):
                // the window + health poll use 127.0.0.1, and a `0.0.0.0` bind
                // would expose the authenticated API to the LAN.
                PIXIVBIU_SERVER_HOST: "127.0.0.1",
                // Deterministic port: we picked it, so disable the walk-forward
                // fallback and poll the exact port for readiness.
                PIXIVBIU_SERVER_PORT: String(port),
                PIXIVBIU_SERVER_PORT_FALLBACK: "false",
                // electron-updater owns updates in desktop builds; silence the
                // core's own update loop.
                PIXIVBIU_APP_UPDATE_ENABLED: "false",
            },
            // Forward the core's stdout/stderr (slog + boot banner) to ours so
            // they show up in the terminal / Console for diagnostics.
            stdio: ["ignore", "inherit", "inherit"],
        });

        let exited = false;
        const onExit = () => {
            exited = true;
        };
        child.once("exit", onExit);
        child.once("error", onExit);

        try {
            await waitForHealth(port, () => exited);
            return { child, port };
        } catch (err) {
            lastErr = err;
            try {
                child.kill();
            } catch {
                // Already gone.
            }
            // Loop: pick a new port and try again (covers the rare bind race).
        } finally {
            // The readiness listeners have done their job either way; main.ts
            // owns the child's lifecycle from here.
            child.removeListener("exit", onExit);
            child.removeListener("error", onExit);
        }
    }

    throw lastErr ?? new Error("failed to start the PixivBiu core");
}

// stopCore terminates the sidecar. On Windows SIGTERM is not honored, so kill
// the whole process tree; elsewhere ask politely, then escalate.
export function stopCore(handle: CoreHandle): void {
    const { child } = handle;
    if (child.exitCode !== null || child.signalCode !== null) return;

    if (process.platform === "win32") {
        const pid = child.pid;
        if (pid !== undefined) {
            try {
                spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
                return;
            } catch {
                // Fall through to child.kill().
            }
        }
        child.kill();
        return;
    }

    child.kill("SIGTERM");
    // Escalate to SIGKILL only if it's still alive after a grace period. unref()
    // + clear-on-exit so this timer never keeps the app alive during a clean quit
    // where the child already exited on SIGTERM.
    const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
        }
    }, 3_000);
    killTimer.unref();
    child.once("exit", () => clearTimeout(killTimer));
}
