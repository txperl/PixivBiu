import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import { createCore } from "./core-process";
import type { CoreSupervisor, CoreFailure, CoreState } from "./core-supervisor";
import { installCoreProtocol, registerCoreScheme } from "./core-protocol";
import { installMenu } from "./menu";
import { captureOAuthCode } from "./oauth-window";
import {
    CORE_BASE_URL,
    failurePage,
    startingPage,
    desktopFailureAction,
    isAllowedExternalURL,
    isPixivOAuthLoginURL,
    isTrustedCoreURL,
    isTrustedIPCEvent,
} from "./security";
import { initUpdater } from "./updater";
import { chromeArgs, chromeOptions, trackWindowChrome, type WindowChromeState } from "./window-chrome";
import { PreferenceStore } from "./preferences";
import { restoreWindowState, trackWindowState } from "./window-state";

// Keep this in sync with electron-builder.yml::appId. NSIS assigns the same
// AUMID to shortcuts; Windows needs the running process to claim it before the
// first window opens so taskbar grouping, pinning, and notification icons use
// the packaged application identity.
const APP_ID = "moe.tls.pixivbiu";
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

// Keep local development separate from the installed app and its auth state.
if (!app.isPackaged) {
    app.setName("PixivBiu Development");
    app.setPath("userData", path.join(app.getPath("appData"), "PixivBiu Development"));
}

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
let readWindowChrome: (() => WindowChromeState) | null = null;
let core: CoreSupervisor | null = null;
let failureURL: string | null = null;
let mainDocumentURL: string | null = null;
let quitting = false;
let quitReady = false;
let quitOperation: Promise<void> | null = null;

const PRELOAD = path.join(__dirname, "preload.js");
const APP_ICON_NAME = process.platform === "win32" ? "icon.ico" : "icon.png";
const APP_ICON = app.isPackaged
    ? path.join(process.resourcesPath, APP_ICON_NAME)
    : path.join(__dirname, "..", "build", APP_ICON_NAME);

const failureMessages: Record<CoreFailure, string> = {
    start_failed: "The local service could not start. Check the logs, then try again.",
    incompatible_core: app.isPackaged
        ? "This desktop package includes an incompatible component. Please install a matching desktop release."
        : "The development core does not support the desktop lifecycle protocol. Rebuild the core with make dist, then try again.",
    startup_timeout: "The local service took too long to start. Check the logs, then try again.",
    core_exited: "The local service stopped unexpectedly. Your saved data is still available. Try again to reconnect.",
    stop_failed: "The local service could not be stopped. Check the logs before trying again.",
};

function loadMainURL(url: string): void {
    mainDocumentURL = url;
    void mainWindow?.loadURL(url).catch(() => {
        // A newer lifecycle state can supersede an in-flight navigation.
        // Browser/network error details may contain user URLs; keep them local.
        console.error("[desktop] Main document navigation did not complete");
    });
}

function showCoreState(state: CoreState, failure?: CoreFailure): void {
    if (!mainWindow || quitting) return;
    if (state === "failed") {
        failureURL = failurePage(failureMessages[failure ?? "start_failed"]);
        loadMainURL(failureURL);
    } else if (state === "starting") {
        failureURL = null;
        loadMainURL(startingPage());
    } else if (state === "ready") {
        failureURL = null;
        // A settings restart keeps the SPA mounted: its existing REST/SSE
        // reconnect paths pick up the supervisor's new port through the proxy.
        if (mainDocumentURL !== CORE_BASE_URL) loadMainURL(CORE_BASE_URL);
    }
}

function resumeAfterFailedUpdate(): void {
    if (!quitReady) return;
    quitting = false;
    quitReady = false;
    core = createCore(showCoreState);
    if (!mainWindow) createMainWindow();
    void core.start();
}

async function prepareQuit(): Promise<void> {
    if (quitReady) return;
    if (quitOperation) return quitOperation;
    quitting = true;
    quitOperation = (async () => {
        await core?.stop();
        if (core?.state === "failed") throw new Error("The local service could not be stopped. Please try closing PixivBiu again.");
        quitReady = true;
    })().catch(error => {
        quitting = false;
        throw error;
    }).finally(() => { quitOperation = null; });
    return quitOperation;
}

// Never initialize defaultSession: even an empty persistent cookie store can
// request the OS encryption key. Protocol, network and permissions share this session.
const mainSession = () => session.fromPartition("pixivbiu-main");

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
            session: mainSession(),
            preload: PRELOAD,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: !app.isPackaged,
            additionalArguments: chromeArgs(),
        },
    });
    mainWindow = win;
    readWindowChrome = trackWindowChrome(win);
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
        const action = desktopFailureAction(win.webContents.getURL(), failureURL, url);
        if (action) {
            e.preventDefault();
            if (action === "retry" && !quitting) void core?.start();
            if (action === "logs") void shell.openPath(app.getPath("logs"));
            return;
        }
        if (core?.port == null || !isTrustedCoreURL(url)) e.preventDefault();
    });

    win.once("ready-to-show", () => win.show());
    win.on("close", event => {
        // Keep the last Windows/Linux window available while cleanup runs,
        // including when an OS termination failure needs another close attempt.
        // macOS window dismissal still keeps downloads alive in the Dock.
        if (process.platform !== "darwin" && !quitReady) {
            event.preventDefault();
            if (!quitting) app.quit();
        }
    });
    win.on("closed", () => {
        if (mainWindow === win) {
            mainWindow = null;
            readWindowChrome = null;
            mainDocumentURL = null;
        }
    });

    if (core?.state === "failed") showCoreState("failed", core.failure);
    else loadMainURL(core?.port != null ? CORE_BASE_URL : startingPage());
}

if (gotInstanceLock) {
    app.on("second-instance", () => {
        if (quitting) return;
        if (!mainWindow) {
            createMainWindow();
            return;
        }
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(async () => {
        if (quitting) return;
        installMenu();
        core = createCore(showCoreState);
        installCoreProtocol(mainSession(), () => core?.port ?? null);
        const preferences = new PreferenceStore(path.join(app.getPath("userData"), "ui-preferences.json"));
        ipcMain.handle("pixivbiu:window-chrome-read", (event) => {
            if (!isTrustedIPCEvent(event, mainWindow)) throw new Error("unauthorized_ipc");
            return readWindowChrome?.();
        });
        ipcMain.handle("pixivbiu:preferences-read", (event) => {
            if (!isTrustedIPCEvent(event, mainWindow)) throw new Error("unauthorized_ipc");
            return preferences.read();
        });
        ipcMain.handle("pixivbiu:preferences-write", (event, key: unknown, value: unknown) => {
            if (!isTrustedIPCEvent(event, mainWindow)) throw new Error("unauthorized_ipc");
            preferences.write(key, value);
        });

        // Renderer permission policy: deny everything except the clipboard
        // access the SPA actually uses (login paste, copy buttons), scoped to
        // the core origin.
        mainSession().setPermissionRequestHandler((webContents, permission, cb, details) => {
            const allowed = permission === "clipboard-read" || permission === "clipboard-sanitized-write";
            cb(
                allowed &&
                    !!core &&
                    webContents === mainWindow?.webContents &&
                    isTrustedCoreURL(details.requestingUrl),
            );
        });
        mainSession().setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
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

        initUpdater(() => mainWindow, prepareQuit, resumeAfterFailedUpdate);
        createMainWindow();
        void core.start();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                if (quitting) return;
                createMainWindow();
                void core?.start();
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
app.on("before-quit", (event) => {
    if (quitReady || !gotInstanceLock) return;
    event.preventDefault();
    void prepareQuit().then(() => app.quit()).catch(error => {
        dialog.showErrorBox("PixivBiu could not close", String(error.message));
    });
});
