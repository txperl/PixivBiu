import type { Illust } from "@/features/search/api";

export type TrendingTag = {
    // Raw Pixiv tag name — what we send as the search keyword.
    name: string;
    // Translated label for display; falls back to `name` when absent.
    label: string;
    count: number;
};

export function extractTopTags(illusts: readonly Illust[], limit: number): TrendingTag[] {
    const buckets = new Map<string, TrendingTag>();
    for (const il of illusts) {
        for (const tag of il.tags) {
            const name = tag.name?.trim();
            if (!name) continue;
            const existing = buckets.get(name);
            if (existing) {
                existing.count++;
                // Prefer a translated label whenever any occurrence supplies one.
                if (existing.label === existing.name && tag.translated_name) {
                    existing.label = tag.translated_name;
                }
            } else {
                buckets.set(name, {
                    name,
                    label: tag.translated_name || name,
                    count: 1,
                });
            }
        }
    }
    const all = Array.from(buckets.values());
    all.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return all.slice(0, limit);
}

const CACHE_KEY = "pixivbiu.search.trending.day.v1";
const CACHE_TTL_MS = 30 * 60 * 1000;

type CacheShape = {
    at: number;
    tags: TrendingTag[];
};

export function readTrendingCache(): TrendingTag[] | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CacheShape;
        if (!parsed || typeof parsed.at !== "number" || !Array.isArray(parsed.tags)) return null;
        if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
        return parsed.tags;
    } catch {
        return null;
    }
}

export function writeTrendingCache(tags: readonly TrendingTag[]) {
    if (typeof window === "undefined") return;
    try {
        const payload: CacheShape = { at: Date.now(), tags: [...tags] };
        window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {
        // Ignore quota / privacy errors.
    }
}
