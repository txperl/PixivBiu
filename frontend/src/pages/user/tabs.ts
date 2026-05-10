import type { IconSvgElement } from "@hugeicons/react";
import { FollowIcon, HeartIcon, ImageIcon, MagnetIcon, MangaIcon } from "@/lib/icons";

export type Tab = "illust" | "manga" | "bookmarks" | "bookmarks_private" | "following";

export const TABS = [
    "illust",
    "manga",
    "following",
    "bookmarks",
    "bookmarks_private",
] as const satisfies readonly Tab[];

export const TAB_LABELS: Record<Tab, string> = {
    illust: "插画",
    manga: "漫画",
    following: "关注",
    bookmarks: "收藏",
    bookmarks_private: "私密",
};

export const TAB_ICONS: Record<Tab, IconSvgElement> = {
    illust: ImageIcon,
    manga: MangaIcon,
    following: FollowIcon,
    bookmarks: HeartIcon,
    bookmarks_private: MagnetIcon,
};

const DEFAULT_TAB: Tab = "illust";
const OWNER_ONLY_TABS = new Set<Tab>(["bookmarks_private"]);

export const isBookmarkTab = (t: Tab) => t === "bookmarks" || t === "bookmarks_private";
export const isOwnerOnlyTab = (t: Tab) => OWNER_ONLY_TABS.has(t);

// undefined → omit from URL (default tab is implicit).
export const tabToParam = (t: Tab): string | undefined => (t === DEFAULT_TAB ? undefined : t);

export function isTab(v: string | null | undefined): v is Tab {
    return v != null && (TABS as readonly string[]).includes(v);
}

export function normalizeTab(v: string | null | undefined): Tab {
    return isTab(v) ? v : DEFAULT_TAB;
}

export function readTab(sp: URLSearchParams): Tab {
    return normalizeTab(sp.get("tab"));
}
