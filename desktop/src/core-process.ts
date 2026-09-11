import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { CoreSupervisor, type CoreState, type CoreFailure } from "./core-supervisor";
import { CoreDiagnostics } from "./core-diagnostics";

// The shell owns OS paths; the same portable core opts into a private,
// versioned lifecycle protocol when launched as a desktop sidecar.
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

export function createCore(onState: (state: CoreState, failure?: CoreFailure) => void): CoreSupervisor {
    seedFirstRunDefaults();
    return new CoreSupervisor({
        binary: coreBinaryPath(),
        diagnostics: new CoreDiagnostics(path.join(app.getPath("logs"), "core-startup.log")),
        onState,
        env: {
            ...process.env,
            PIXIVBIU_DATA_DIR: app.getPath("userData"),
            PIXIVBIU_CACHE_DIR: osCacheDir(),
            PIXIVBIU_LOG_FILE: path.join(app.getPath("logs"), "pixivbiu.log"),
            PIXIVBIU_APP_OPEN_BROWSER: "false",
            PIXIVBIU_SERVER_HOST: "127.0.0.1",
            PIXIVBIU_SERVER_PORT_FALLBACK: "false",
            PIXIVBIU_APP_UPDATE_ENABLED: "false",
        },
    });
}
