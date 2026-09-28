import { readTab, type Tab } from "@/pages/user/tabs";

/**
 * Sidebar sections. Each maps a set of locations to one nav item, so the sidebar can
 * highlight the owning item, remember the section's last URL, and key kept-alive pages.
 * The signed-in user's own `/user/:id` page splits into three sections by tab group.
 */
export type SectionId = "home" | "search" | "rank" | "bookmark" | "follow" | "self" | "dl" | "settings";

type Loc = { pathname: string; search: string };
type SelfId = number | null | undefined;

// Search params that describe an overlay, not the page — never remembered or compared.
const TRANSIENT_PARAMS = ["illust"];

export function normalizePathname(pathname: string): string {
    return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}

function selfTabSection(tab: Tab): SectionId {
    if (tab === "bookmarks" || tab === "bookmarks_private") return "bookmark";
    if (tab === "following") return "follow";
    return "self";
}

export function sectionOf(loc: Loc, selfId: SelfId): SectionId | null {
    const path = normalizePathname(loc.pathname);
    if (path === "/") return "home";
    if (path === "/search" || path.startsWith("/search/")) return "search";
    if (path === "/ranking") return "rank";
    if (path === "/downloads") return "dl";
    if (path === "/settings") return "settings";
    if (selfId != null && path === `/user/${selfId}`) return selfTabSection(readTab(new URLSearchParams(loc.search)));
    return null;
}

/** The section's landing URL; null for personal sections while the user id is unknown. */
export function sectionDefaultUrl(id: SectionId, selfId: SelfId): string | null {
    switch (id) {
        case "home":
            return "/";
        case "search":
            return "/search";
        case "rank":
            return "/ranking";
        case "dl":
            return "/downloads";
        case "settings":
            return "/settings";
        case "bookmark":
            return selfId != null ? `/user/${selfId}?tab=bookmarks` : null;
        case "follow":
            return selfId != null ? `/user/${selfId}?tab=following` : null;
        case "self":
            return selfId != null ? `/user/${selfId}` : null;
    }
}

// Comparable form of a query string: transient params dropped, the implicit default
// user tab removed, keys sorted.
function canonicalSearch(search: string): string {
    const sp = new URLSearchParams(search);
    for (const p of TRANSIENT_PARAMS) sp.delete(p);
    if (sp.get("tab") === "illust") sp.delete("tab");
    sp.sort();
    return sp.toString();
}

/** Whether `loc` is exactly the section's landing view (ignoring overlays like the viewer). */
export function isAtSectionRoot(id: SectionId, loc: Loc, selfId: SelfId): boolean {
    const def = sectionDefaultUrl(id, selfId);
    if (def == null) return false;
    const [defPath, defSearch = ""] = def.split("?");
    return normalizePathname(loc.pathname) === defPath && canonicalSearch(loc.search) === canonicalSearch(defSearch);
}

/** `pathname + search` without overlay params, for remembering where a section was left. */
export function stripTransientParams(loc: Loc): string {
    const sp = new URLSearchParams(loc.search);
    for (const p of TRANSIENT_PARAMS) sp.delete(p);
    const search = sp.toString();
    return search ? `${loc.pathname}?${search}` : loc.pathname;
}
