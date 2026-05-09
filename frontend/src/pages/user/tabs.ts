export type Tab = "illust" | "manga" | "bookmarks" | "following";

export const TABS = ["illust", "manga", "bookmarks", "following"] as const satisfies readonly Tab[];

export const TAB_LABELS: Record<Tab, string> = {
    illust: "插画",
    manga: "漫画",
    bookmarks: "收藏",
    following: "关注",
};

export function isTab(v: string | null | undefined): v is Tab {
    return v != null && (TABS as readonly string[]).includes(v);
}

export function normalizeTab(v: string | null | undefined): Tab {
    return isTab(v) ? v : "illust";
}

export function readTab(sp: URLSearchParams): Tab {
    return normalizeTab(sp.get("tab"));
}
