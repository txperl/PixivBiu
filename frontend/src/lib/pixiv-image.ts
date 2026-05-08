// TEMP bridge while the backend i.pximg.net reverse-proxy is still Out of Scope
// (see AGENTS.md). Drop this file once `/api/v1/proxy/img` (or similar) lands
// and switch consumers to the proxied URL.
const PXIMG_HOST_RE = /\bi\.pximg\.net\b/g;

export function rewritePximgUrl(url: string | null | undefined): string {
    if (!url) return "";
    return url.replace(PXIMG_HOST_RE, "i.pixiv.cat");
}
