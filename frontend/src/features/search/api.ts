import { queryOptions } from "@tanstack/react-query";
import { api, type components, unwrap } from "@/lib/api";
import { keepPreviousPage } from "@/lib/query/keep-previous-page";

export type SearchTarget = components["schemas"]["SearchTarget"];
export type SearchSort = components["schemas"]["SearchSort"];
export type SearchDuration = components["schemas"]["SearchDuration"];
export type ClientMode = components["schemas"]["ClientMode"];
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

// User search offers only Pixiv-native sorts.
export const SEARCH_SORTS: readonly SearchSort[] = ["date_desc", "date_asc", "popular_desc"] as const;

// bookmarks_desc / views_desc are synthetic: the backend samples date_desc results
// and ranks them locally, so they work for any account (Pixiv's popular_desc is
// Premium-only). They paginate in disjoint windows of SEARCH_PAGE_SIZE *
// sample.pages — each page is re-ranked and next_offset advances to the next
// window (see useRankedPageSize + the backend's searchIllustsRanked).
const RANKED_SEARCH_SORTS: readonly SearchSort[] = ["bookmarks_desc", "views_desc"] as const;

// Illust search offers the native sorts plus the synthetic ranked ones.
export const SEARCH_ILLUST_SORTS: readonly SearchSort[] = [...SEARCH_SORTS, ...RANKED_SEARCH_SORTS];

export function isRankedSearchSort(sort: SearchSort): boolean {
    return (RANKED_SEARCH_SORTS as readonly string[]).includes(sort);
}

export const SEARCH_DURATIONS: readonly SearchDuration[] = [
    "within_last_day",
    "within_last_week",
    "within_last_month",
] as const;

export const DEFAULT_SEARCH_TARGET: SearchTarget = "partial_match_for_tags";
// Illust search defaults to bookmarks_desc — the synthetic "Most bookmarked"
// ranked sort that works for any account (Pixiv's popular_desc is Premium-only).
export const DEFAULT_SEARCH_ILLUST_SORT: SearchSort = "bookmarks_desc";
// User search has no ranked sorts; it stays on Pixiv's native newest-first.
export const DEFAULT_SEARCH_USER_SORT: SearchSort = "date_desc";

// URL query keys that scope the search page's state (the search-illust /
// search-user pages read these). `page` is intentionally absent: a new
// keyword should restart pagination from 1.
export const SEARCH_PARAM_KEYS = [
    "type",
    "target",
    "sort",
    "duration",
    "start_date",
    "end_date",
    "exclude_ai",
] as const;

export type SearchIllustsParams = {
    word: string;
    searchTarget?: SearchTarget;
    sort?: SearchSort;
    startDate?: string;
    endDate?: string;
    duration?: SearchDuration;
    excludeAi?: boolean;
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
                start_date: params.startDate,
                end_date: params.endDate,
                duration: params.duration,
                exclude_ai: params.excludeAi,
                offset: params.offset,
            },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

export type SearchUsersParams = {
    word: string;
    sort?: SearchSort;
    duration?: SearchDuration;
    offset?: number;
};

export async function searchUsers(
    params: SearchUsersParams,
): Promise<{ data: UserPreviewPage | null; error: SearchApiError | null }> {
    const { data, error } = await api.GET("/search/users", {
        params: {
            query: {
                word: params.word,
                sort: params.sort,
                duration: params.duration,
                offset: params.offset,
            },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

// Query factories (see AGENTS.md "Data fetching"). Both are offset-paged. keepPreviousPage is
// baked in here (the factory owns the key shape): a page jump keeps the prior page on screen,
// but a new keyword/filter shows a skeleton instead of the old results lingering as "success".
export function searchIllustsQueryOptions(params: SearchIllustsParams) {
    return queryOptions<IllustPage, SearchApiError>({
        queryKey: ["search-illusts", params],
        queryFn: () => searchIllusts(params).then(unwrap),
        placeholderData: keepPreviousPage(params, ["offset"]),
    });
}

export function searchUsersQueryOptions(params: SearchUsersParams) {
    return queryOptions<UserPreviewPage, SearchApiError>({
        queryKey: ["search-users", params],
        queryFn: () => searchUsers(params).then(unwrap),
        placeholderData: keepPreviousPage(params, ["offset"]),
    });
}
