// Mirror of the contextBridge surface the Electron shell exposes on
// `window.pixivbiu` (see desktop/src/preload.ts). This is the single source of
// truth for the bridge contract on the SPA side; the SPA feature-detects the
// bridge and falls back to the normal web behaviour when it is absent.

// Keep the snapshot/error contract aligned with desktop/src/update-types.ts.
export type DesktopUpdateErrorCode =
    | "check_failed"
    | "download_failed"
    | "verification_failed"
    | "stop_failed"
    | "install_failed"
    | "not_supported";
export interface DesktopUpdateSnapshot {
    sequence: number;
    currentVersion: string;
    format: "nsis" | "mac" | "appimage" | "deb" | "rpm" | "unsupported";
    installMode: "in-app" | "external" | "disabled";
    state:
        | "idle"
        | "checking"
        | "not-available"
        | "available"
        | "downloading"
        | "downloaded"
        | "preparing-install"
        | "installing"
        | "error";
    version?: string;
    notes?: string;
    releaseUrl?: string;
    installerUrl?: string;
    publishedAt?: string;
    lastChecked?: string;
    percent?: number;
    readyToInstall?: boolean;
    error?: DesktopUpdateErrorCode;
    previousInstallFailed?: boolean;
    installRecoveryRequired?: boolean;
}

export type DesktopUpdateStatus =
    | { state: "checking" }
    | { state: "available"; version: string; notes?: string }
    | { state: "not-available" }
    | { state: "downloading"; percent: number }
    | { state: "downloaded"; version: string; notes?: string }
    | { state: "error"; message: string }
    | DesktopUpdateSnapshot;

export interface DesktopWindowChromeState {
    fullscreen: boolean;
}

export interface DesktopBridge {
    // Optional for older shells. Window operations remain native.
    windowChrome?: {
        read(): Promise<DesktopWindowChromeState>;
        onState(cb: (state: DesktopWindowChromeState) => void): () => void;
    };
    // Opens an Electron window at the hosted Pixiv login URL, intercepts the
    // OAuth callback redirect, and resolves the authorization code.
    captureOAuthCode(loginUrl: string): Promise<string>;
    updates: {
        // Optional so a newer embedded SPA can still use an older shell.
        read?(): Promise<DesktopUpdateSnapshot>;
        download?(): Promise<void>;
        restartAndInstall?(): Promise<void>;
        check(): Promise<void>;
        downloadAndInstall(): Promise<void>;
        onStatus(cb: (status: DesktopUpdateStatus) => void): () => void;
    };
    preferences: {
        read(): Promise<Record<string, string>>;
        write(key: string, value: string): Promise<void>;
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
