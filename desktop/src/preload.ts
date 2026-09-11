import { contextBridge, ipcRenderer } from "electron";
import type { WindowChromeState } from "./window-chrome";

// Authored startup/failure data documents have no SPA and cannot invoke core
// IPC. They only consume the shell's notification after load/state changes.
ipcRenderer.on("pixivbiu:window-chrome-state", (_event, state: WindowChromeState) => {
    if (location.protocol === "data:") {
        document.documentElement?.toggleAttribute("data-window-fullscreen", state.fullscreen);
    }
});

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
    windowChrome: {
        read: (): Promise<WindowChromeState> => ipcRenderer.invoke("pixivbiu:window-chrome-read"),
        onState: (cb: (state: WindowChromeState) => void): (() => void) => {
            const listener = (_e: unknown, state: WindowChromeState) => cb(state);
            ipcRenderer.on("pixivbiu:window-chrome-state", listener);
            return () => ipcRenderer.removeListener("pixivbiu:window-chrome-state", listener);
        },
    },
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

    preferences: {
        read: (): Promise<Record<string, string>> => ipcRenderer.invoke("pixivbiu:preferences-read"),
        write: (key: string, value: string): Promise<void> => ipcRenderer.invoke("pixivbiu:preferences-write", key, value),
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
