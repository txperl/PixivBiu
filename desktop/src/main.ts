import path from "node:path";
import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { startCore, stopCore, type CoreHandle } from "./core-process";
import { installMenu } from "./menu";
import { captureOAuthCode } from "./oauth-window";
import { initUpdater } from "./updater";
import { chromeArgs, chromeOptions } from "./window-chrome";
import { restoreWindowState, trackWindowState } from "./window-state";

// One window, one core. A second launch focuses the existing window rather than
// starting a second sidecar against the same user-data dir.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
    app.quit();
}

let mainWindow: BrowserWindow | null = null;
let core: CoreHandle | null = null;
let coreError: string | null = null;
let coreStarting: Promise<void> | null = null;

const PRELOAD = path.join(__dirname, "preload.js");

function failurePage(detail: string): string {
    const body =
        `<body style="margin:0;font:14px/1.6 system-ui,sans-serif;padding:3rem;background:#0b0b0c;color:#e7e7ea">` +
        `<h2 style="font-weight:500">PixivBiu couldn't start its core service.</h2>` +
        `<p style="color:#a0a0a8">Try relaunching the app. If this persists, please report it.</p>` +
        `<pre style="white-space:pre-wrap;color:#8a8a92;margin-top:1.5rem">${detail}</pre></body>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(body)}`;
}

// ensureCore starts the sidecar once per app run; a failed start is retried on
// the next call (macOS dock re-activate can heal a transient failure).
function ensureCore(): Promise<void> {
    if (core) return Promise.resolve();
    coreStarting ??= startCore()
        .then((handle) => {
            core = handle;
            coreError = null;
        })
        .catch((err) => {
            coreError = String(err);
        })
        .finally(() => {
            coreStarting = null;
        });
    return coreStarting;
}

// createMainWindow is re-entrant: on macOS the window is recreated on dock
// activate against the already-running core. One-time wiring (core, updater,
// IPC, menu) lives in app.whenReady below.
function createMainWindow(): void {
    const state = restoreWindowState();
    const win = new BrowserWindow({
        ...state.bounds,
        minWidth: 960,
        minHeight: 600,
        show: false,
        title: "PixivBiu",
        ...chromeOptions(),
        webPreferences: {
            preload: PRELOAD,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            additionalArguments: chromeArgs(),
        },
    });
    mainWindow = win;
    trackWindowState(win);
    if (state.isMaximized) win.maximize();

    // External links (target=_blank, "View on GitHub", etc.) open in the OS
    // browser; the window only ever hosts the loopback SPA.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            void shell.openExternal(url);
        }
        return { action: "deny" };
    });

    // Page-initiated navigation is locked to the core origin. loadURL from the
    // main process (including the data: failure page) doesn't fire this event.
    win.webContents.on("will-navigate", (e, url) => {
        if (!core || !url.startsWith(core.baseUrl)) e.preventDefault();
    });

    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
        if (mainWindow === win) mainWindow = null;
    });

    void win.loadURL(core ? core.baseUrl : failurePage(coreError ?? "unknown error"));
}

if (gotInstanceLock) {
    app.on("second-instance", () => {
        if (!mainWindow) {
            createMainWindow();
            return;
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(async () => {
        installMenu();

        // Renderer permission policy: deny everything except the clipboard
        // access the SPA actually uses (login paste, copy buttons), scoped to
        // the core origin.
        session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
            const allowed = permission === "clipboard-read" || permission === "clipboard-sanitized-write";
            cb(allowed && !!core && details.requestingUrl.startsWith(core.baseUrl));
        });

        // Automated Pixiv OAuth: validate the URL is the Pixiv host we expect,
        // then open the capture window and return the authorization code.
        ipcMain.handle("pixivbiu:oauth-capture", (_e, loginUrl: unknown) => {
            if (typeof loginUrl !== "string" || !loginUrl.startsWith("https://app-api.pixiv.net/")) {
                throw new Error("invalid_login_url");
            }
            return captureOAuthCode(loginUrl, mainWindow ?? undefined);
        });

        await ensureCore();
        initUpdater(() => mainWindow);
        createMainWindow();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                void ensureCore().then(createMainWindow);
            }
        });
    });
}

// macOS: closing the window keeps the app (and the core sidecar) alive in the
// dock — activate recreates the window against the same core, so downloads
// keep running. Elsewhere the last window ends the app.
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

// The core is a child tied to this app — never leave it orphaned.
app.on("before-quit", () => {
    if (core) {
        stopCore(core);
        core = null;
    }
});
