// Mirror of the contextBridge surface the Electron shell exposes on
// `window.pixivbiu` (see desktop/src/preload.ts). This is the single source of
// truth for the bridge contract on the SPA side; the SPA feature-detects the
// bridge and falls back to the normal web behaviour when it is absent.

export type DesktopUpdateStatus =
    | { state: "checking" }
    | { state: "available"; version: string; notes?: string }
    | { state: "not-available" }
    | { state: "downloading"; percent: number }
    | { state: "downloaded"; version: string; notes?: string }
    | { state: "error"; message: string };

export interface DesktopBridge {
    // Opens an Electron window at the hosted Pixiv login URL, intercepts the
    // OAuth callback redirect, and resolves the authorization code.
    captureOAuthCode(loginUrl: string): Promise<string>;
    updates: {
        check(): Promise<void>;
        downloadAndInstall(): Promise<void>;
        onStatus(cb: (status: DesktopUpdateStatus) => void): () => void;
    };
    platform: {
        os: string;
        arch: string;
        // Shell-declared window chrome (desktop/src/window-chrome.ts). Optional
        // because old shells don't send them; absent means framed + opaque, so
        // the SPA draws no drag regions and keeps solid backgrounds.
        frameless?: boolean;
        frost?: boolean;
    };
}

declare global {
    interface Window {
        pixivbiu?: DesktopBridge;
    }
}

// isDesktop reports whether the SPA is running inside the Electron shell.
export function isDesktop(): boolean {
    return typeof window !== "undefined" && !!window.pixivbiu;
}

// desktopBridge returns the bridge, asserting it exists. Guard call sites with
// isDesktop() first.
export function desktopBridge(): DesktopBridge {
    const bridge = typeof window !== "undefined" ? window.pixivbiu : undefined;
    if (!bridge) throw new Error("desktop bridge unavailable");
    return bridge;
}
