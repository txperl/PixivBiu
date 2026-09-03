import { app, ipcMain, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "./preload";
import { isTrustedIPCEvent } from "./security";

// NOTE: electron-updater is CJS that sets `__esModule` but exposes no default
// export — only named ones (autoUpdater, …). A default import would be undefined
// at runtime under esModuleInterop, so import `autoUpdater` by name.

type GetWindow = () => BrowserWindow | null;

// electron-updater accepts string release notes or a list of {version, note}.
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

// initUpdater wires electron-updater's lifecycle to the renderer over IPC and
// registers the check/install handlers the preload bridge invokes. The renderer
// drives the UX (show notes, confirm); we never pop native dialogs.
export function initUpdater(getWindow: GetWindow): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    const send = (status: UpdateStatus) => {
        getWindow()?.webContents.send("pixivbiu:update-status", status);
    };

    autoUpdater.on("checking-for-update", () => send({ state: "checking" }));
    autoUpdater.on("update-available", (info) =>
        send({ state: "available", version: info.version, notes: normalizeNotes(info.releaseNotes) }),
    );
    autoUpdater.on("update-not-available", () => send({ state: "not-available" }));
    autoUpdater.on("download-progress", (p) => send({ state: "downloading", percent: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded", (info) =>
        send({ state: "downloaded", version: info.version, notes: normalizeNotes(info.releaseNotes) }),
    );
    autoUpdater.on("error", (err) => send({ state: "error", message: String(err?.message ?? err) }));

    ipcMain.handle("pixivbiu:update-check", async (event) => {
        if (!isTrustedIPCEvent(event, getWindow())) throw new Error("unauthorized_ipc");
        await autoUpdater.checkForUpdates();
    });

    ipcMain.handle("pixivbiu:update-install", async (event) => {
        if (!isTrustedIPCEvent(event, getWindow())) throw new Error("unauthorized_ipc");
        // Download, then quit & install once the bytes are in place.
        autoUpdater.once("update-downloaded", () => autoUpdater.quitAndInstall());
        await autoUpdater.downloadUpdate();
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
