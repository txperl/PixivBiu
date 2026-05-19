import type { components } from "@/lib/api";
import type { AspectRatio, GeneralFilters, IllustTypeKey, XRestrictKey } from "./types";

type Illust = components["schemas"]["Illust"];

function classifyXRestrict(v: number): XRestrictKey {
    if (v === 1) return "r18";
    if (v === 2) return "r18g";
    return "safe";
}

function classifyAspect(w: number, h: number): AspectRatio {
    if (w <= 0 || h <= 0) return "square";
    const r = w / h;
    if (r > 1.1) return "landscape";
    if (r < 0.9) return "portrait";
    return "square";
}

function lowercaseTagSurface(illust: Illust): string[] {
    const out: string[] = [];
    for (const tag of illust.tags) {
        out.push(tag.name.toLowerCase());
        if (tag.translated_name) out.push(tag.translated_name.toLowerCase());
    }
    return out;
}

function anyMatch(surface: ReadonlyArray<string>, lcTokens: ReadonlyArray<string>): boolean {
    for (const t of lcTokens) {
        for (const s of surface) if (s.includes(t)) return true;
    }
    return false;
}

function matches(illust: Illust, f: GeneralFilters, lcInclude: string[], lcExclude: string[]): boolean {
    if (f.xRestrict.length > 0 && !f.xRestrict.includes(classifyXRestrict(illust.x_restrict))) return false;

    if (f.ai === "exclude" && illust.illust_ai_type === 2) return false;
    if (f.ai === "only" && illust.illust_ai_type !== 2) return false;

    if (f.illustType.length > 0 && !(f.illustType as readonly string[]).includes(illust.type as IllustTypeKey))
        return false;

    if (f.minBookmarks > 0 && illust.total_bookmarks < f.minBookmarks) return false;
    if (f.minViews > 0 && illust.total_view < f.minViews) return false;

    if (f.pageCount === "single" && illust.page_count !== 1) return false;
    if (f.pageCount === "multi" && illust.page_count <= 1) return false;

    if (f.aspectRatio.length > 0 && !f.aspectRatio.includes(classifyAspect(illust.width, illust.height))) return false;

    if (f.bookmarked === "only" && !illust.is_bookmarked) return false;
    if (f.bookmarked === "exclude" && illust.is_bookmarked) return false;

    if (lcInclude.length > 0 || lcExclude.length > 0) {
        const surface = lowercaseTagSurface(illust);
        if (lcInclude.length > 0 && !anyMatch(surface, lcInclude)) return false;
        if (lcExclude.length > 0 && anyMatch(surface, lcExclude)) return false;
    }

    return true;
}

export function applyGeneralFilters(illusts: readonly Illust[], f: GeneralFilters): Illust[] {
    const lcInclude = f.includeTags.map((t) => t.toLowerCase());
    const lcExclude = f.excludeTags.map((t) => t.toLowerCase());
    return illusts.filter((il) => matches(il, f, lcInclude, lcExclude));
}
