export type AiFilter = "any" | "exclude" | "only";
export type PageCountFilter = "any" | "single" | "multi";
export type BookmarkedFilter = "any" | "only" | "exclude";
export type AspectRatio = "landscape" | "portrait" | "square";
export type IllustTypeKey = "illust" | "manga" | "ugoira";
export type XRestrictKey = "safe" | "r18" | "r18g";

export const MIN_BOOKMARKS_TIERS = [0, 100, 500, 1000, 5000] as const;
export type MinBookmarksTier = (typeof MIN_BOOKMARKS_TIERS)[number];

export const MIN_VIEWS_TIERS = [0, 1000, 5000, 10000, 50000] as const;
export type MinViewsTier = (typeof MIN_VIEWS_TIERS)[number];

export type GeneralFilters = {
    xRestrict: ReadonlyArray<XRestrictKey>;
    ai: AiFilter;
    illustType: ReadonlyArray<IllustTypeKey>;
    minBookmarks: MinBookmarksTier;
    minViews: MinViewsTier;
    pageCount: PageCountFilter;
    aspectRatio: ReadonlyArray<AspectRatio>;
    includeTags: ReadonlyArray<string>;
    excludeTags: ReadonlyArray<string>;
    bookmarked: BookmarkedFilter;
};

export const DEFAULT_GENERAL_FILTERS: GeneralFilters = {
    xRestrict: [],
    ai: "any",
    illustType: [],
    minBookmarks: 0,
    minViews: 0,
    pageCount: "any",
    aspectRatio: [],
    includeTags: [],
    excludeTags: [],
    bookmarked: "any",
};

export type GeneralFilterFlags = Record<keyof GeneralFilters, boolean>;

export function getGeneralFilterFlags(f: GeneralFilters): GeneralFilterFlags {
    return {
        xRestrict: f.xRestrict.length > 0,
        ai: f.ai !== "any",
        illustType: f.illustType.length > 0,
        minBookmarks: f.minBookmarks !== 0,
        minViews: f.minViews !== 0,
        pageCount: f.pageCount !== "any",
        aspectRatio: f.aspectRatio.length > 0,
        bookmarked: f.bookmarked !== "any",
        includeTags: f.includeTags.length > 0,
        excludeTags: f.excludeTags.length > 0,
    };
}

export function countActiveGeneralFilters(f: GeneralFilters): number {
    return Object.values(getGeneralFilterFlags(f)).filter(Boolean).length;
}

export function isGeneralFiltersDefault(f: GeneralFilters): boolean {
    return countActiveGeneralFilters(f) === 0;
}
