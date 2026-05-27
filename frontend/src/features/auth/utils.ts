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

// Upstream (Pixiv) errors sometimes come through as a JSON blob serialized
// with `ensure_ascii=True`, so the human-readable text is buried under
// `\uXXXX` escapes inside a nested string. JSON.parse decodes both the
// structure and the escapes in one shot; recurse to find the first `message`
// field. Falls back to a regex decode for non-JSON blobs.
export function humanizeAuthError(text: string | undefined | null): string | undefined {
    if (!text) return undefined;
    try {
        const found = findMessage(JSON.parse(text));
        if (found) return found;
    } catch {
        // Not JSON; fall through.
    }
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function findMessage(obj: unknown): string | undefined {
    if (typeof obj === "string") return obj;
    if (!obj || typeof obj !== "object") return undefined;
    const o = obj as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    for (const v of Object.values(o)) {
        const found = findMessage(v);
        if (found) return found;
    }
    return undefined;
}
