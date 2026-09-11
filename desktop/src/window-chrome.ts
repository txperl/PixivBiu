import os from "node:os";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

// Per-platform window chrome: frameless title bars and frosted (translucent)
// backdrops. The SPA learns what the shell actually did via the
// --pixivbiu-frameless / --pixivbiu-frost args (see preload.ts), selecting
// matching layout and backdrop treatments when supported by the bundled SPA.

// Light-scheme fallbacks matching the SPA's surface tokens
// (frontend/src/styles/material-you.css --md-sys-color-surface / on-surface).
const SOLID_BG = "#fdf7ff";
const WCO_SYMBOL = "#1c1b20";

// Height of the Windows caption-button overlay; the SPA's title bar uses
// env(titlebar-area-height) with a fallback that must match this value.
export const WCO_HEIGHT = 36;

export interface WindowChromeState {
    fullscreen: boolean;
}

// Read-only state: geometry remains Chromium's responsibility (WCO CSS env).
// Native and HTML fullscreen have separate lifetimes; either hides our chrome.
export function trackWindowChrome(win: BrowserWindow): () => WindowChromeState {
    let htmlFullscreen = false;
    const read = (): WindowChromeState => ({ fullscreen: win.isFullScreen() || htmlFullscreen });
    const publish = () => win.webContents.send("pixivbiu:window-chrome-state", read());
    win.on("enter-full-screen", publish);
    win.on("leave-full-screen", publish);
    win.webContents.on("enter-html-full-screen", () => {
        htmlFullscreen = true;
        publish();
    });
    win.webContents.on("leave-html-full-screen", () => {
        htmlFullscreen = false;
        publish();
    });
    win.webContents.on("did-finish-load", publish);
    return read;
}

// Mica requires Win11 22H2+ (build 22621, DWMWA_SYSTEMBACKDROP_TYPE).
function win32Build(): number {
    return Number(os.release().split(".")[2] ?? 0);
}

// frostCapable reports whether the OS can render a translucent window backdrop
// (macOS vibrancy, Win11 mica). Linux keeps a solid native-framed window —
// frameless/transparent windows are unreliable across compositors.
export function frostCapable(): boolean {
    if (process.platform === "darwin") return true;
    if (process.platform === "win32") return win32Build() >= 22621;
    return false;
}

export function framelessChrome(): boolean {
    return process.platform === "darwin" || process.platform === "win32";
}

export function chromeOptions(): BrowserWindowConstructorOptions {
    if (process.platform === "darwin") {
        return {
            titleBarStyle: "hiddenInset",
            // Lights sit inside the sidebar's top inset; the SPA pads the
            // sidebar by 44px to clear them.
            trafficLightPosition: { x: 18, y: 16 },
            // Finder/Notes source-list material; tracks light/dark and window
            // focus automatically. backgroundColor must be fully transparent
            // for the material to show (and it kills the first-paint flash).
            vibrancy: "sidebar",
            backgroundColor: "#00000000",
        };
    }
    if (process.platform === "win32") {
        const frost = frostCapable();
        return {
            titleBarStyle: "hidden",
            titleBarOverlay: {
                // Caption buttons float over the frost; solid surface color
                // when mica is unavailable.
                color: frost ? "#00000000" : SOLID_BG,
                symbolColor: WCO_SYMBOL,
                height: WCO_HEIGHT,
            },
            ...(frost
                ? { backgroundMaterial: "mica" as const, backgroundColor: "#00000000" }
                : { backgroundColor: SOLID_BG }),
        };
    }
    return { backgroundColor: SOLID_BG };
}

// chromeArgs are appended to the renderer's argv so the preload bridge can
// report the shell's actual chrome to the SPA (frontend/src/lib/desktop.ts).
export function chromeArgs(): string[] {
    return [
        ...(framelessChrome() ? ["--pixivbiu-frameless"] : []),
        ...(frostCapable() ? ["--pixivbiu-frost"] : []),
    ];
}

// Startup/failure documents load before the SPA. Give them the same reserved
// strip without granting these data documents access to core-origin IPC.
export function shellPageChrome(): string {
    const height = process.platform === "win32" ? WCO_HEIGHT : process.platform === "darwin" ? 44 : 0;
    return `<style>
        :root { --chrome-height: ${height}px; }
        ${process.platform === "win32" ? `:root { --chrome-height: max(${WCO_HEIGHT}px, calc(env(titlebar-area-y, 0px) + env(titlebar-area-height, ${WCO_HEIGHT}px))); }` : ""}
        :root[data-window-fullscreen] { --chrome-height: 0px; }
        body { margin: 0; font: 14px/1.6 system-ui,sans-serif; background: ${SOLID_BG}; color: ${WCO_SYMBOL}; }
        .window-titlebar { height: var(--chrome-height); overflow: hidden; app-region: drag; -webkit-app-region: drag; user-select: none; }
        .window-titlebar span { display: block; box-sizing: border-box; margin-left: env(titlebar-area-x, 0px); width: env(titlebar-area-width, 0px); padding: 0 16px; overflow: hidden; white-space: nowrap; font-size: 12px; line-height: var(--chrome-height); opacity: .6; }
        main { padding: 3rem; }
        a { color: #65558f; app-region: no-drag; -webkit-app-region: no-drag; }
    </style>`;
}
