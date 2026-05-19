import {
    type AspectRatio,
    DEFAULT_GENERAL_FILTERS,
    type GeneralFilters,
    type IllustTypeKey,
    MIN_BOOKMARKS_TIERS,
    MIN_VIEWS_TIERS,
    type MinBookmarksTier,
    type MinViewsTier,
    type XRestrictKey,
} from "./types";

const STORAGE_KEY = "pixivbiu.general-filters";

const X_RESTRICT_SET = new Set<XRestrictKey>(["safe", "r18", "r18g"]);
const ILLUST_TYPE_SET = new Set<IllustTypeKey>(["illust", "manga", "ugoira"]);
const ASPECT_SET = new Set<AspectRatio>(["landscape", "portrait", "square"]);

function sanitizeStrings(v: unknown, allowed?: Set<string>): string[] {
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of v) {
        if (typeof item !== "string") continue;
        if (allowed && !allowed.has(item)) continue;
        if (seen.has(item)) continue;
        seen.add(item);
        out.push(item);
    }
    return out;
}

function sanitize(raw: unknown): GeneralFilters {
    if (!raw || typeof raw !== "object") return DEFAULT_GENERAL_FILTERS;
    const r = raw as Record<string, unknown>;
    const minBookmarks = (MIN_BOOKMARKS_TIERS as readonly number[]).includes(r.minBookmarks as number)
        ? (r.minBookmarks as MinBookmarksTier)
        : 0;
    const minViews = (MIN_VIEWS_TIERS as readonly number[]).includes(r.minViews as number)
        ? (r.minViews as MinViewsTier)
        : 0;
    return {
        xRestrict: sanitizeStrings(r.xRestrict, X_RESTRICT_SET as Set<string>) as XRestrictKey[],
        ai: r.ai === "exclude" || r.ai === "only" ? r.ai : "any",
        illustType: sanitizeStrings(r.illustType, ILLUST_TYPE_SET as Set<string>) as IllustTypeKey[],
        minBookmarks,
        minViews,
        pageCount: r.pageCount === "single" || r.pageCount === "multi" ? r.pageCount : "any",
        aspectRatio: sanitizeStrings(r.aspectRatio, ASPECT_SET as Set<string>) as AspectRatio[],
        includeTags: sanitizeStrings(r.includeTags),
        excludeTags: sanitizeStrings(r.excludeTags),
        bookmarked: r.bookmarked === "only" || r.bookmarked === "exclude" ? r.bookmarked : "any",
    };
}

function read(): GeneralFilters {
    if (typeof window === "undefined") return DEFAULT_GENERAL_FILTERS;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_GENERAL_FILTERS;
        return sanitize(JSON.parse(raw));
    } catch {
        return DEFAULT_GENERAL_FILTERS;
    }
}

let snapshot: GeneralFilters = read();
const subscribers = new Set<() => void>();

function notify() {
    for (const fn of subscribers) fn();
}

if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
        if (e.key !== STORAGE_KEY) return;
        snapshot = read();
        notify();
    });
}

export function subscribe(fn: () => void): () => void {
    subscribers.add(fn);
    return () => {
        subscribers.delete(fn);
    };
}

export function getSnapshot(): GeneralFilters {
    return snapshot;
}

function shallowEqual(a: GeneralFilters, b: GeneralFilters): boolean {
    return (
        a.ai === b.ai &&
        a.minBookmarks === b.minBookmarks &&
        a.minViews === b.minViews &&
        a.pageCount === b.pageCount &&
        a.bookmarked === b.bookmarked &&
        sameArray(a.xRestrict, b.xRestrict) &&
        sameArray(a.illustType, b.illustType) &&
        sameArray(a.aspectRatio, b.aspectRatio) &&
        sameArray(a.includeTags, b.includeTags) &&
        sameArray(a.excludeTags, b.excludeTags)
    );
}

function sameArray<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function write(next: GeneralFilters) {
    if (shallowEqual(snapshot, next)) return;
    snapshot = next;
    if (typeof window !== "undefined") {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // localStorage may be unavailable (private mode / quota)
        }
    }
    notify();
}

export function setFilters(patch: Partial<GeneralFilters>): void {
    write({ ...snapshot, ...patch });
}

export function resetFilters(): void {
    write(DEFAULT_GENERAL_FILTERS);
}
