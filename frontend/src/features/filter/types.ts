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

export function isGeneralFiltersDefault(f: GeneralFilters): boolean {
    return (
        f.xRestrict.length === 0 &&
        f.ai === "any" &&
        f.illustType.length === 0 &&
        f.minBookmarks === 0 &&
        f.minViews === 0 &&
        f.pageCount === "any" &&
        f.aspectRatio.length === 0 &&
        f.includeTags.length === 0 &&
        f.excludeTags.length === 0 &&
        f.bookmarked === "any"
    );
}
