// Centralized URL and document policy for the privileged Electron process.
// Keep this module free of Electron imports so its decisions can be exercised
// directly by Node's test runner.

export const CORE_SCHEME = "pixivbiu";
export const CORE_ORIGIN = `${CORE_SCHEME}://core`;
export const CORE_BASE_URL = `${CORE_ORIGIN}/`;

export const PIXIV_OAUTH_LOGIN_URL = "https://app-api.pixiv.net/web/v1/login";
// Keep in sync with pixivOAuthRedirectURI in internal/pixiv/oauth_code.go.
export const PIXIV_OAUTH_CALLBACK_URL = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback";

export const APP_CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
].join("; ");

function parseURL(rawUrl: string): URL | null {
    try {
        return new URL(rawUrl);
    } catch {
        return null;
    }
}

function hasCleanAuthority(url: URL): boolean {
    return url.username === "" && url.password === "" && url.port === "";
}

export function isTrustedCoreURL(rawUrl: string): boolean {
    const url = parseURL(rawUrl);
    return (
        url !== null &&
        url.protocol === `${CORE_SCHEME}:` &&
        url.hostname === "core" &&
        hasCleanAuthority(url)
    );
}

export function isAllowedExternalURL(rawUrl: string): boolean {
    const url = parseURL(rawUrl);
    return (
        url !== null &&
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === ""
    );
}

export function isPixivOAuthLoginURL(rawUrl: string): boolean {
    const url = parseURL(rawUrl);
    return (
        url !== null &&
        url.protocol === "https:" &&
        url.hostname === "app-api.pixiv.net" &&
        hasCleanAuthority(url) &&
        url.pathname === "/web/v1/login"
    );
}

export function isPixivOAuthCallbackURL(rawUrl: string): boolean {
    const url = parseURL(rawUrl);
    return (
        url !== null &&
        url.protocol === "https:" &&
        url.hostname === "app-api.pixiv.net" &&
        hasCleanAuthority(url) &&
        url.pathname === "/web/v1/users/auth/pixiv/callback"
    );
}

export function extractPixivOAuthCode(rawUrl: string): string | null {
    if (!isPixivOAuthCallbackURL(rawUrl)) return null;
    const code = parseURL(rawUrl)?.searchParams.get("code") ?? "";
    return code.length > 0 ? code : null;
}

type IPCEventLike = {
    sender: unknown;
    senderFrame: { url: string } | null;
};

type MainWindowLike = {
    webContents: { mainFrame: unknown };
};

export function isTrustedIPCEvent(event: IPCEventLike, window: MainWindowLike | null): boolean {
    if (!window || !event.senderFrame) return false;
    return (
        event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame &&
        isTrustedCoreURL(event.senderFrame.url)
    );
}

export function escapeHTML(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
        switch (character) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            default:
                return "&#39;";
        }
    });
}

export function failurePage(detail: string): string {
    const body =
        "<!doctype html><html><head><meta charset=\"utf-8\">" +
        `<meta http-equiv="Content-Security-Policy" content="${APP_CONTENT_SECURITY_POLICY}">` +
        "<meta name=\"referrer\" content=\"no-referrer\"></head>" +
        `<body style="margin:0;font:14px/1.6 system-ui,sans-serif;padding:3rem;background:#0b0b0c;color:#e7e7ea">` +
        `<h2 style="font-weight:500">PixivBiu couldn't start its core service.</h2>` +
        `<p style="color:#a0a0a8">Try relaunching the app. If this persists, please report it.</p>` +
        `<pre style="white-space:pre-wrap;color:#8a8a92;margin-top:1.5rem">${escapeHTML(detail)}</pre></body></html>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(body)}`;
}
