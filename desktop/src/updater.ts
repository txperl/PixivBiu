import { readFile } from "node:fs/promises";
import path from "node:path";
import { app, ipcMain, session, type BrowserWindow } from "electron";
import { autoUpdater, type NsisUpdater, type UpdateInfo } from "electron-updater";
import { CoreDiagnostics } from "./core-diagnostics";
import { UpdateController } from "./update-controller";
import { UpdateStore } from "./update-store";
import type { UpdateFormat } from "./update-types";
import { type GitHubRelease, parseFeedRepository, stitchReleaseNotes } from "./release-notes";
import { isTrustedIPCEvent } from "./security";

// Named import: electron-updater is CJS with __esModule but no default export.
type GetWindow = () => BrowserWindow | null;
const RELEASES_FETCH_TIMEOUT_MS = 5_000;

async function fetchStitchedNotes(latest: string): Promise<string | undefined> {
    try {
        const feed = parseFeedRepository(await readFile(path.join(process.resourcesPath, "app-update.yml"), "utf8"));
        if (!feed) return undefined;
        const response = await session.fromPartition("pixivbiu-release-notes", { cache: false }).fetch(
            "https://api.github.com/repos/" + feed.owner + "/" + feed.repo + "/releases?per_page=30", {
                headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(RELEASES_FETCH_TIMEOUT_MS),
            });
        if (!response.ok) return undefined;
        return stitchReleaseNotes((await response.json()) as GitHubRelease[], app.getVersion(), latest);
    } catch { return undefined; }
}

export async function detectUpdateFormat(platform: string, resources: string, appImage?: string): Promise<UpdateFormat> {
    if (platform === "win32") return "nsis";
    if (platform === "darwin") return "mac";
    if (platform !== "linux") return "unsupported";
    // Package identity takes precedence over inherited APPIMAGE environment.
    const identity = await readFile(path.join(resources, "package-type"), "utf8").catch(() => "");
    if (identity.trim() === "deb") return "deb";
    if (identity.trim() === "rpm") return "rpm";
    return appImage && path.isAbsolute(appImage) ? "appimage" : "unsupported";
}

export function configureWindowsInstallDirectory(updater: Pick<NsisUpdater, "installDirectory">, executable: string): void {
    // Repeated silent NSIS upgrades can fall back to the default directory even
    // when InstallLocation is intact. Bind the public API to the running app,
    // preserving the user's directory without executing a persisted cache path.
    if (!path.isAbsolute(executable)) throw new Error("invalid_install_directory");
    updater.installDirectory = path.dirname(executable);
}

export function initUpdater(getWindow: GetWindow, prepareQuit: () => Promise<void>, resumeAfterFailedUpdate: () => void): { beginQuit(): void; cancelQuit(): void } {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.disableWebInstaller = true;
    const diagnostics = new CoreDiagnostics(path.join(app.getPath("logs"), "desktop-update.log"));
    const log = (action: string, error?: unknown) => {
        const detail = error instanceof Error ? error.name + ": " + error.message + "\n" + (error.stack ?? "") : String(error ?? "");
        const safe = detail.replace(/https?:\/\/[^\s)]+/g, value => {
            try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
            catch { return "[url]"; }
        }).replace(/(Bearer\s+|(?:token|password|authorization)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]");
        diagnostics.append(new Date().toISOString() + " " + action + (safe ? " " + safe.slice(0, 4096) : "") + "\n");
    };
    autoUpdater.logger = { info: () => {}, warn: value => log("updater-warning", value), error: value => log("updater-error", value) };
    app.on("before-quit", () => { void diagnostics.flush(); });

    let activeController: UpdateController | undefined;
    let quitRequested = false;
    const controller = (async () => {
        const format = await detectUpdateFormat(process.platform, process.resourcesPath, process.env.APPIMAGE);
        if (app.isPackaged && format === "nsis") configureWindowsInstallDirectory(autoUpdater as NsisUpdater, app.getPath("exe"));
        const feed = parseFeedRepository(await readFile(path.join(process.resourcesPath, "app-update.yml"), "utf8").catch(() => ""));
        const controller = new UpdateController(autoUpdater, {
            currentVersion: app.getVersion(), format, packaged: app.isPackaged,
            store: new UpdateStore(path.join(app.getPath("userData"), "update-state.json")),
            prepareQuit, resume: resumeAfterFailedUpdate, appImageFile: process.env.APPIMAGE,
            send: status => getWindow()?.webContents.send("pixivbiu:update-status", status), log,
            notes: info => fetchStitchedNotes(info.version),
            links: async (info: UpdateInfo) => {
                if (!feed) return {};
                const releaseBase = "https://github.com/" + feed.owner + "/" + feed.repo + "/releases/";
                const releaseUrl = releaseBase + "tag/v" + encodeURIComponent(info.version);
                const file = format === "deb" || format === "rpm" ? info.files.find(file => file.url.endsWith("." + format)) : undefined;
                // Only the configured feed can supply an external installer link.
                const filename = file ? path.basename(decodeURIComponent(new URL(file.url, "https://updates.invalid/").pathname)) : undefined;
                return { releaseUrl, installerUrl: filename
                    ? releaseBase + "download/v" + encodeURIComponent(info.version) + "/" + encodeURIComponent(filename) : undefined };
            },
        });
        activeController = controller;
        if (quitRequested) controller.beginQuit();
        return controller;
    })();
    const beginQuit = () => { quitRequested = true; activeController?.beginQuit(); };
    app.on("before-quit", beginQuit);
    const handle = (channel: string, operation: (controller: UpdateController) => unknown) => {
        ipcMain.handle(channel, async event => {
            if (!isTrustedIPCEvent(event, getWindow())) throw new Error("unauthorized_ipc");
            try { return await operation(await controller); }
            catch (error) {
                log("ipc-update-failed", error);
                const code = error instanceof Error && /^(check_failed|download_failed|verification_failed|stop_failed|install_failed|not_supported)$/.test(error.message)
                    ? error.message : "check_failed";
                throw new Error(code);
            }
        });
    };
    handle("pixivbiu:update-read", controller => controller.read());
    handle("pixivbiu:update-check", controller => controller.check());
    handle("pixivbiu:update-download", controller => controller.download());
    handle("pixivbiu:update-restart", controller => controller.restartAndInstall());
    handle("pixivbiu:update-install", controller => controller.downloadAndInstall());
    if (app.isPackaged) {
        const timer = setTimeout(() => { void controller.then(controller => controller.check()).catch(error => log("startup-check-failed", error)); }, 3_000);
        timer.unref();
        app.once("before-quit", () => clearTimeout(timer));
    }
    void controller.catch(error => log("updater-setup-failed", error));
    return { beginQuit, cancelQuit: () => { quitRequested = false; activeController?.cancelQuit(); } };
}
