import { api, type components } from "@/lib/api";

export type SearchTarget = components["schemas"]["SearchTarget"];
export type SearchSort = components["schemas"]["SearchSort"];
export type IllustPage = components["schemas"]["IllustPage"];
export type UserPreviewPage = components["schemas"]["UserPreviewPage"];
export type Illust = components["schemas"]["Illust"];
export type UserPreview = components["schemas"]["UserPreview"];
export type SearchApiError = components["schemas"]["Error"];

export const SEARCH_PAGE_SIZE = 30;

export const SEARCH_TARGETS: readonly SearchTarget[] = [
    "partial_match_for_tags",
    "exact_match_for_tags",
    "title_and_caption",
    "keyword",
] as const;

export const SEARCH_SORTS: readonly SearchSort[] = ["date_desc", "date_asc", "popular_desc"] as const;

export const DEFAULT_SEARCH_TARGET: SearchTarget = "partial_match_for_tags";
export const DEFAULT_SEARCH_SORT: SearchSort = "date_desc";

export type SearchIllustsParams = {
    word: string;
    searchTarget?: SearchTarget;
    sort?: SearchSort;
    offset?: number;
};

export async function searchIllusts(
    params: SearchIllustsParams,
): Promise<{ data: IllustPage | null; error: SearchApiError | null }> {
    const { data, error } = await api.GET("/search/illusts", {
        params: {
            query: {
                word: params.word,
                search_target: params.searchTarget,
                sort: params.sort,
                offset: params.offset,
            },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

export type SearchUsersParams = {
    word: string;
    offset?: number;
};

export async function searchUsers(
    params: SearchUsersParams,
): Promise<{ data: UserPreviewPage | null; error: SearchApiError | null }> {
    const { data, error } = await api.GET("/search/users", {
        params: {
            query: {
                word: params.word,
                offset: params.offset,
            },
        },
    });
    return { data: data ?? null, error: error ?? null };
}
