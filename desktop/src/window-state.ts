import fs from "node:fs";
import path from "node:path";
import { app, screen, type BrowserWindow, type Rectangle } from "electron";

// Remembers window size/position across launches in userData/window-state.json.
// Deliberately hand-rolled: it's ~90 lines, and the npm alternatives are
// unmaintained and don't validate against the current display topology.

const DEFAULT_SIZE = { width: 1440, height: 900 };
const SAVE_DEBOUNCE_MS = 500;

type SavedState = { bounds?: Rectangle; isMaximized?: boolean };

export type RestoredState = {
    bounds: { x?: number; y?: number; width: number; height: number };
    isMaximized: boolean;
};

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

// A saved rect is restorable only if enough of it intersects some display's
// workArea to grab the (virtual) title strip: >=100px wide, >=40px tall.
// Guards against restoring onto an unplugged monitor.
function isVisibleOnSomeDisplay(b: Rectangle): boolean {
    return screen.getAllDisplays().some(({ workArea: w }) => {
        const ix = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
        const iy = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
        return ix >= 100 && iy >= 40;
    });
}

// restoreWindowState returns the saved bounds when they're still sane, else the
// default size clamped to the primary display (Electron centers unpositioned
// windows). Call after app.whenReady() — it touches the screen module.
export function restoreWindowState(): RestoredState {
    const { workArea } = screen.getPrimaryDisplay();
    const fallback: RestoredState = {
        bounds: {
            width: Math.min(DEFAULT_SIZE.width, workArea.width),
            height: Math.min(DEFAULT_SIZE.height, workArea.height),
        },
        isMaximized: false,
    };
    try {
        const raw = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as SavedState;
        const b = raw.bounds;
        if (
            b &&
            [b.x, b.y, b.width, b.height].every((n) => Number.isFinite(n)) &&
            b.width >= 400 &&
            b.height >= 300 &&
            isVisibleOnSomeDisplay(b)
        ) {
            return { bounds: b, isMaximized: raw.isMaximized === true };
        }
        return { ...fallback, isMaximized: raw.isMaximized === true };
    } catch {
        return fallback;
    }
}

// trackWindowState persists the window's normal bounds (debounced) so the next
// launch restores them. getNormalBounds() keeps the un-maximized rect even
// while maximized/fullscreen, so "restore down" survives a maximized session.
// macOS fullscreen is intentionally not persisted.
export function trackWindowState(win: BrowserWindow): void {
    let timer: NodeJS.Timeout | undefined;
    const snapshot = (): SavedState => ({
        bounds: win.getNormalBounds(),
        isMaximized: win.isMaximized(),
    });
    const write = () => {
        try {
            fs.writeFileSync(stateFile(), JSON.stringify(snapshot()));
        } catch {
            // Non-fatal: worst case the next launch uses defaults.
        }
    };
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(write, SAVE_DEBOUNCE_MS);
    };
    win.on("resize", schedule);
    win.on("move", schedule);
    win.on("maximize", schedule);
    win.on("unmaximize", schedule);
    win.on("close", () => {
        clearTimeout(timer);
        write();
    });
}
