import { contextBridge, ipcRenderer } from "electron";

// The bridge exposed to the renderer (the SPA served by the core). Keep this
// surface minimal and typed; the SPA mirrors this contract in
// frontend/src/lib/desktop.ts and feature-detects it via `window.pixivbiu`.

export type UpdateStatus =
    | { state: "checking" }
    | { state: "available"; version: string; notes?: string }
    | { state: "not-available" }
    | { state: "downloading"; percent: number }
    | { state: "downloaded"; version: string; notes?: string }
    | { state: "error"; message: string };

const pixivbiu = {
    // Automated Pixiv login: hand the hosted login URL to the main process,
    // which opens a window, intercepts the OAuth callback redirect, and resolves
    // the authorization code — no DevTools, no copy/paste.
    captureOAuthCode: (loginUrl: string): Promise<string> => ipcRenderer.invoke("pixivbiu:oauth-capture", loginUrl),

    // Whole-app updates are owned by electron-updater; the SPA renders status
    // through its existing update UI instead of the core's /system/update path.
    updates: {
        check: (): Promise<void> => ipcRenderer.invoke("pixivbiu:update-check"),
        downloadAndInstall: (): Promise<void> => ipcRenderer.invoke("pixivbiu:update-install"),
        onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
            const listener = (_e: unknown, status: UpdateStatus) => cb(status);
            ipcRenderer.on("pixivbiu:update-status", listener);
            return () => ipcRenderer.removeListener("pixivbiu:update-status", listener);
        },
    },

    platform: {
        os: process.platform,
        arch: process.arch,
        // Shell-declared window chrome (see window-chrome.ts). Absent flags —
        // e.g. an old shell hosting a newer frontend — mean framed + opaque,
        // so the SPA draws no drag regions and keeps solid backgrounds.
        frameless: process.argv.includes("--pixivbiu-frameless"),
        frost: process.argv.includes("--pixivbiu-frost"),
    },
};

export type PixivbiuBridge = typeof pixivbiu;

contextBridge.exposeInMainWorld("pixivbiu", pixivbiu);
