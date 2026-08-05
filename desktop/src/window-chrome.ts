import os from "node:os";
import type { BrowserWindowConstructorOptions } from "electron";

// Per-platform window chrome: frameless title bars and frosted (translucent)
// backdrops. The SPA learns what the shell actually did via the
// --pixivbiu-frameless / --pixivbiu-frost args (see preload.ts), so an old
// core's frontend under this shell simply renders opaque — never broken.

// Light-scheme fallbacks matching the SPA's surface tokens
// (frontend/src/styles/material-you.css --md-sys-color-surface / on-surface).
const SOLID_BG = "#fdf7ff";
const WCO_SYMBOL = "#1c1b20";

// Height of the Windows caption-button overlay; the SPA's drag strip uses
// env(titlebar-area-height) with a fallback that must match this value.
export const WCO_HEIGHT = 36;

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
