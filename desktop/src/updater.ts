import { readFile } from "node:fs/promises";
import path from "node:path";
import { app, ipcMain, session, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "./preload";
import { type GitHubRelease, parseFeedRepository, stitchReleaseNotes } from "./release-notes";
import { isTrustedIPCEvent } from "./security";

// NOTE: electron-updater is CJS that sets `__esModule` but exposes no default
// export — only named ones (autoUpdater, …). A default import would be undefined
// at runtime under esModuleInterop, so import `autoUpdater` by name.

type GetWindow = () => BrowserWindow | null;

// electron-updater accepts string release notes or a list of {version, note}.
// Desktop releases embed Markdown in latest*.yml; older ones fell back to the
// GitHub feed's HTML.
type RawNotes = string | Array<{ note: string | null }> | null | undefined;

function normalizeNotes(notes: RawNotes): string | undefined {
    if (!notes) return undefined;
    if (typeof notes === "string") return notes;
    const joined = notes
        .map((n) => n.note ?? "")
        .filter(Boolean)
        .join("\n\n");
    return joined || undefined;
}

const RELEASES_FETCH_TIMEOUT_MS = 5_000;

// fetchStitchedNotes returns the changelogs of every release between the
// running version and latest, or undefined (no gap, offline, rate-limited, …)
// so the caller keeps the single-release notes from latest*.yml.
async function fetchStitchedNotes(latest: string): Promise<string | undefined> {
    try {
        const feed = parseFeedRepository(await readFile(path.join(process.resourcesPath, "app-update.yml"), "utf8"));
        if (!feed) return undefined;
        const url = `https://api.github.com/repos/${feed.owner}/${feed.repo}/releases?per_page=30`;
        // A dedicated in-memory, uncached partition: net.fetch would initialize
        // defaultSession, which the shell never touches (see main.ts).
        const response = await session.fromPartition("pixivbiu-release-notes", { cache: false }).fetch(url, {
            headers: { Accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(RELEASES_FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return undefined;
        return stitchReleaseNotes((await response.json()) as GitHubRelease[], app.getVersion(), latest);
    } catch {
        return undefined;
    }
}

// initUpdater wires electron-updater's lifecycle to the renderer over IPC and
// registers the check/install handlers the preload bridge invokes. The renderer
// drives the UX (show notes, confirm); we never pop native dialogs.
export function initUpdater(getWindow: GetWindow, prepareQuit: () => Promise<void>, resumeAfterFailedUpdate: () => void): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    const send = (status: UpdateStatus) => {
        getWindow()?.webContents.send("pixivbiu:update-status", status);
    };

    // Report the release immediately with its own notes, then upgrade them in
    // place once notes stitched across skipped versions arrive. Stitching runs
    // once per offered version; later events reuse the result, while a miss
    // (offline, nothing to stitch) is forgotten so a later check retries.
    const stitched = new Map<string, Promise<string | undefined>>();
    type Offer = Extract<UpdateStatus, { state: "available" | "downloaded" }>;
    let offered: Offer | undefined;
    const sendOffer = (state: Offer["state"], version: string, releaseNotes: RawNotes) => {
        const offer: Offer = { state, version, notes: normalizeNotes(releaseNotes) };
        offered = offer;
        send(offer);
        let pending = stitched.get(version);
        if (!pending) {
            pending = fetchStitchedNotes(version).then((notes) => {
                if (!notes) stitched.delete(version);
                return notes;
            });
            stitched.set(version, pending);
        }
        void pending.then((notes) => {
            if (!notes || offered?.version !== version || offered.notes === notes) return;
            const upgraded: Offer = { ...offered, notes };
            offered = upgraded;
            send(upgraded);
        });
    };

    autoUpdater.on("checking-for-update", () => send({ state: "checking" }));
    autoUpdater.on("update-available", (info) => sendOffer("available", info.version, info.releaseNotes));
    autoUpdater.on("update-not-available", () => {
        offered = undefined;
        send({ state: "not-available" });
    });
    autoUpdater.on("download-progress", (p) => send({ state: "downloading", percent: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (info) => sendOffer("downloaded", info.version, info.releaseNotes));
    let preparedForInstall = false;
    autoUpdater.on("error", (err) => {
        send({ state: "error", message: String(err?.message ?? err) });
        if (preparedForInstall) {
            preparedForInstall = false;
            resumeAfterFailedUpdate();
        }
    });

    ipcMain.handle("pixivbiu:update-check", async (event) => {
        if (!isTrustedIPCEvent(event, getWindow())) throw new Error("unauthorized_ipc");
        await autoUpdater.checkForUpdates();
    });

    let installation: Promise<void> | undefined;
    ipcMain.handle("pixivbiu:update-install", async (event) => {
        if (!isTrustedIPCEvent(event, getWindow())) throw new Error("unauthorized_ipc");
        // Windows updater starts the installer before app.before-quit. Stop
        // the bundled executable first so it cannot hold files open during replacement.
        installation ??= (async () => {
            await autoUpdater.downloadUpdate();
            await prepareQuit();
            preparedForInstall = true;
            try {
                autoUpdater.quitAndInstall();
            } catch (error) {
                preparedForInstall = false;
                resumeAfterFailedUpdate();
                throw error;
            }
        })().finally(() => { installation = undefined; });
        await installation;
    });

    // electron-updater only works in a packaged app; skip the auto-check in dev
    // so it doesn't error on a missing update feed.
    if (app.isPackaged) {
        setTimeout(() => {
            autoUpdater.checkForUpdates().catch(() => {
                // Surfaced via the 'error' event above.
            });
        }, 3_000);
    }
}
