// A paste-issue kind the caller resolves to a localized hint string. This
// helper is not a React component, so it can't call useMessages(); it returns
// a stable key instead and lets the component pick the message.
export type PasteIssue = "intermediate" | "pixiv" | "generic";

// detectPasteIssue returns the kind of friendly hint for inputs that look like
// they're going to fail before we even round-trip the server — e.g. the user
// pasted the Pixiv intermediate page URL (which has no `code=`) instead of the
// callback URL. Returns null when the value looks plausible.
export function detectPasteIssue(raw: string): PasteIssue | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/[?&]code=/.test(trimmed)) return null;
    let url: URL | null = null;
    try {
        url = new URL(trimmed);
    } catch {
        return null;
    }
    if (url.hostname === "accounts.pixiv.net") {
        return "intermediate";
    }
    if (url.hostname.endsWith("pixiv.net")) {
        return "pixiv";
    }
    return "generic";
}
