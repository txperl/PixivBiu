import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { startCore, stopCore, type CoreHandle } from "./core-process";
import { installCoreProtocol, registerCoreScheme } from "./core-protocol";
import { installMenu } from "./menu";
import { captureOAuthCode } from "./oauth-window";
import {
    CORE_BASE_URL,
    CORE_ORIGIN,
    failurePage,
    isAllowedExternalURL,
    isPixivOAuthLoginURL,
    isTrustedCoreURL,
    isTrustedIPCEvent,
} from "./security";
import { initUpdater } from "./updater";
import { chromeArgs, chromeOptions } from "./window-chrome";
import { restoreWindowState, trackWindowState } from "./window-state";

// Keep this in sync with electron-builder.yml::appId. NSIS assigns the same
// AUMID to shortcuts; Windows needs the running process to claim it before the
// first window opens so taskbar grouping, pinning, and notification icons use
// the packaged application identity.
const APP_ID = "moe.tls.pixivbiu";
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

// Apply Chromium's OS-level sandbox to every renderer, including any future
// BrowserWindow that might otherwise omit its per-window sandbox flag.
app.enableSandbox();

// One window, one core. A second launch focuses the existing window rather than
// starting a second sidecar against the same user-data dir.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
    app.quit();
}

registerCoreScheme();

let mainWindow: BrowserWindow | null = null;
let core: CoreHandle | null = null;
let coreError: string | null = null;
let coreStarting: Promise<void> | null = null;

const PRELOAD = path.join(__dirname, "preload.js");
const APP_ICON_NAME = process.platform === "win32" ? "icon.ico" : "icon.png";
const APP_ICON = app.isPackaged
    ? path.join(process.resourcesPath, APP_ICON_NAME)
    : path.join(__dirname, "..", "build", APP_ICON_NAME);

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

// Builds that predate the pixivbiu:// scheme loaded the SPA from a random
// loopback port per launch, stranding web storage under dead
// http://127.0.0.1:<port> origins. Clear those once; the stable core origin is
// excluded and the login window uses its own persist: partition, so neither is
// touched. If the marker write fails, re-running is harmless for the same
// reason.
function clearLegacyOriginStorage(): void {
    const marker = path.join(app.getPath("userData"), "storage-cleaned");
    if (fs.existsSync(marker)) return;
    void session.defaultSession
        .clearData({ excludeOrigins: [CORE_ORIGIN] })
        .then(() => fs.promises.writeFile(marker, ""))
        .catch(() => {
            // Non-fatal: stale origins are only disk garbage; retried next launch.
        });
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
        // Windows normally falls back to the executable icon; Linux does not
        // have an embedded executable icon, so setting this explicitly also
        // keeps development windows and less conventional WMs branded.
        ...(process.platform === "darwin" ? {} : { icon: APP_ICON }),
        ...chromeOptions(),
        webPreferences: {
            preload: PRELOAD,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: !app.isPackaged,
            additionalArguments: chromeArgs(),
        },
    });
    mainWindow = win;
    trackWindowState(win);
    if (state.isMaximized) win.maximize();

    // External links (target=_blank, "View on GitHub", etc.) open in the OS
    // browser; the window only ever hosts the custom-protocol SPA.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedExternalURL(url)) {
            void shell.openExternal(url);
        }
        return { action: "deny" };
    });

    // Page-initiated navigation is locked to the core origin. loadURL from the
    // main process (including the data: failure page) doesn't fire this event.
    win.webContents.on("will-navigate", (e, url) => {
        if (!core || !isTrustedCoreURL(url)) e.preventDefault();
    });

    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
        if (mainWindow === win) mainWindow = null;
    });

    void win.loadURL(core ? CORE_BASE_URL : failurePage(coreError ?? "unknown error"));
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
        installCoreProtocol(() => core?.port ?? null);
        clearLegacyOriginStorage();

        // Renderer permission policy: deny everything except the clipboard
        // access the SPA actually uses (login paste, copy buttons), scoped to
        // the core origin.
        session.defaultSession.setPermissionRequestHandler((webContents, permission, cb, details) => {
            const allowed = permission === "clipboard-read" || permission === "clipboard-sanitized-write";
            cb(
                allowed &&
                    !!core &&
                    webContents === mainWindow?.webContents &&
                    isTrustedCoreURL(details.requestingUrl),
            );
        });
        session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
            const allowed = permission === "clipboard-read" || permission === "clipboard-sanitized-write";
            return (
                allowed &&
                !!core &&
                webContents === mainWindow?.webContents &&
                isTrustedCoreURL(requestingOrigin)
            );
        });

        // Automated Pixiv OAuth: validate the URL is the Pixiv host we expect,
        // then open the capture window and return the authorization code.
        ipcMain.handle("pixivbiu:oauth-capture", (event, loginUrl: unknown) => {
            if (!isTrustedIPCEvent(event, mainWindow)) throw new Error("unauthorized_ipc");
            if (typeof loginUrl !== "string" || !isPixivOAuthLoginURL(loginUrl)) {
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
