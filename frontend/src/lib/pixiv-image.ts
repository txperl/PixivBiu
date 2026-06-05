// Routes i.pximg.net image URLs through the same-origin backend proxy
// (GET /api/v1/proxy/img), which fetches them with the Pixiv Referer and
// disk-caches them, so images load same-origin and from a persistent
// local cache.
const PXIMG_HOST = "i.pximg.net";

export function rewritePximgUrl(url: string | null | undefined): string {
    if (!url) return "";
    // Match on the actual host, not a substring: a plain includes() would re-wrap
    // an already-proxied URL (/api/v1/proxy/img?url=…i.pximg.net…) or anything that
    // merely contains the hostname as text. Non-absolute URLs (e.g. an
    // already-proxied relative path) fail to parse and are left untouched.
    let host: string;
    try {
        host = new URL(url).hostname;
    } catch {
        return url;
    }
    if (host !== PXIMG_HOST) return url;
    return `/api/v1/proxy/img?url=${encodeURIComponent(url)}`;
}
