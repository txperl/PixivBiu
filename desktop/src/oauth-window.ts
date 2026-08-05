import { BrowserWindow, session, type Event } from "electron";

// This is the feature that justifies a desktop build: automating Pixiv login.
//
// Pixiv's mobile OAuth redirects to a callback URL carrying `?code=…`. In a
// plain browser that callback uses the `pixiv://` scheme (or a blank hosted
// page), so the web app has to ask the user to copy the URL out of DevTools and
// paste it back. A real Chromium BrowserWindow can intercept that redirect
// programmatically — and it renders Pixiv's reCAPTCHA / 2FA natively, unlike
// headless token-grabbers — so the user just signs in and we capture the code.

// The only redirect Pixiv's OAuth backend accepts. The hosted callback page is
// blank/error, but the request URL carries `?code=…`. Keep in sync with
// pixivOAuthRedirectURI in internal/pixiv/oauth_code.go.
const CALLBACK_PREFIX = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback";

// Give up if the user never finishes signing in, so the promise can't dangle.
const LOGIN_TIMEOUT_MS = 5 * 60_000;

// A dedicated, persisted partition so Pixiv's "remember this device" survives
// across logins, and login cookies stay isolated from the app window.
const LOGIN_PARTITION = "persist:pixiv-login";

export class OAuthCancelledError extends Error {
    constructor() {
        super("oauth_cancelled");
        this.name = "OAuthCancelledError";
    }
}

export class OAuthTimeoutError extends Error {
    constructor() {
        super("oauth_timeout");
        this.name = "OAuthTimeoutError";
    }
}

function extractCode(rawUrl: string): string | null {
    if (!rawUrl.startsWith(CALLBACK_PREFIX) && !rawUrl.startsWith("pixiv://")) return null;
    try {
        return new URL(rawUrl).searchParams.get("code");
    } catch {
        return null;
    }
}

// captureOAuthCode opens the hosted Pixiv login URL in a modal child window and
// resolves with the authorization code the moment Pixiv redirects to its
// callback. The caller exchanges that code through the existing
// POST /auth/oauth/exchange path.
export function captureOAuthCode(loginUrl: string, parent?: BrowserWindow): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const ses = session.fromPartition(LOGIN_PARTITION);
        // Pixiv sign-in needs no device permissions; deny everything.
        ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
        const filter = { urls: [`${CALLBACK_PREFIX}*`] };

        const win = new BrowserWindow({
            parent,
            modal: Boolean(parent),
            width: 480,
            height: 720,
            autoHideMenuBar: true,
            title: "Pixiv",
            webPreferences: {
                session: ses,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
            },
        });

        let settled = false;
        const finish = (action: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            action();
        };

        function cleanup() {
            clearTimeout(timer);
            // Clears all onBeforeRequest listeners on this (login-only) session.
            ses.webRequest.onBeforeRequest(null);
            if (!win.isDestroyed()) {
                win.webContents.removeListener("will-redirect", onNav);
                win.webContents.removeListener("will-navigate", onNav);
            }
        }

        const tryCapture = (rawUrl: string): boolean => {
            const code = extractCode(rawUrl);
            if (!code) return false;
            finish(() => {
                resolve(code);
                if (!win.isDestroyed()) win.close();
            });
            return true;
        };

        // Primary capture: intercept the callback request before it hits the
        // network and cancel it (no point loading the blank callback page).
        ses.webRequest.onBeforeRequest(filter, (details, cb) => {
            if (tryCapture(details.url)) {
                cb({ cancel: true });
                return;
            }
            cb({});
        });

        // Backup capture: navigation-level events also fire for the `pixiv://`
        // scheme variant, which never reaches webRequest.
        const onNav = (e: Event, url: string) => {
            if (tryCapture(url)) e.preventDefault();
        };
        win.webContents.on("will-redirect", onNav);
        win.webContents.on("will-navigate", onNav);

        // User dismissed the window before completing sign-in.
        win.on("closed", () => finish(() => reject(new OAuthCancelledError())));

        const timer = setTimeout(() => {
            finish(() => {
                if (!win.isDestroyed()) win.close();
                reject(new OAuthTimeoutError());
            });
        }, LOGIN_TIMEOUT_MS);

        win.loadURL(loginUrl).catch((err: unknown) => {
            finish(() => {
                if (!win.isDestroyed()) win.close();
                reject(err instanceof Error ? err : new Error(String(err)));
            });
        });
    });
}
