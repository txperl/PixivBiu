import path from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { startCore, stopCore, type CoreHandle } from "./core-process";
import { captureOAuthCode } from "./oauth-window";
import { initUpdater } from "./updater";

// One window, one core. A second launch focuses the existing window rather than
// starting a second sidecar against the same user-data dir.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
    app.quit();
}

let mainWindow: BrowserWindow | null = null;
let core: CoreHandle | null = null;

const PRELOAD = path.join(__dirname, "preload.js");

function failurePage(detail: string): string {
    const body =
        `<body style="margin:0;font:14px/1.6 system-ui,sans-serif;padding:3rem;background:#0b0b0c;color:#e7e7ea">` +
        `<h2 style="font-weight:500">PixivBiu couldn't start its core service.</h2>` +
        `<p style="color:#a0a0a8">Try relaunching the app. If this persists, please report it.</p>` +
        `<pre style="white-space:pre-wrap;color:#8a8a92;margin-top:1.5rem">${detail}</pre></body>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(body)}`;
}

async function createMainWindow(): Promise<void> {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 960,
        minHeight: 600,
        backgroundColor: "#0b0b0c",
        show: false,
        title: "PixivBiu",
        webPreferences: {
            preload: PRELOAD,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    // External links (target=_blank, "View on GitHub", etc.) open in the OS
    // browser; the window only ever hosts the loopback SPA.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            void shell.openExternal(url);
        }
        return { action: "deny" };
    });

    mainWindow.once("ready-to-show", () => mainWindow?.show());

    try {
        core = await startCore();
    } catch (err) {
        await mainWindow.loadURL(failurePage(String(err)));
        mainWindow.show();
        return;
    }

    initUpdater(() => mainWindow);
    await mainWindow.loadURL(core.baseUrl);
}

if (gotInstanceLock) {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });

    app.whenReady().then(() => {
        // Automated Pixiv OAuth: validate the URL is the Pixiv host we expect,
        // then open the capture window and return the authorization code.
        ipcMain.handle("pixivbiu:oauth-capture", (_e, loginUrl: unknown) => {
            if (typeof loginUrl !== "string" || !loginUrl.startsWith("https://app-api.pixiv.net/")) {
                throw new Error("invalid_login_url");
            }
            return captureOAuthCode(loginUrl, mainWindow ?? undefined);
        });

        void createMainWindow();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
        });
    });
}

// The core is a child tied to this app — never leave it orphaned.
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
    if (core) {
        stopCore(core);
        core = null;
    }
});
