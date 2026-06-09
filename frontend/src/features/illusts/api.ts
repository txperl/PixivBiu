import { queryOptions } from "@tanstack/react-query";
import { api, type components, unwrap } from "@/lib/api";
import { offsetInfiniteQueryOptions } from "@/lib/query/offset-infinite-query-options";

export type Restrict = components["schemas"]["Restrict"];
export type IllustType = components["schemas"]["IllustType"];
export type BookmarkDetail = components["schemas"]["BookmarkDetail"];
export type Illust = components["schemas"]["Illust"];
export type IllustPage = components["schemas"]["IllustPage"];
export type IllustDetailResponse = components["schemas"]["IllustDetailResponse"];
export type IllustApiError = components["schemas"]["Error"];

// The large-image URL for each page of a work. A work is multi-page only when
// page_count > 1 AND meta_pages is populated (some list payloads omit meta_pages);
// otherwise the single `image_urls.large` is the one page. Shared by the card's
// hover preview and the viewer stage so the predicate can't drift between them.
export function illustPageUrls(illust: Illust): string[] {
    if (illust.page_count > 1 && illust.meta_pages.length > 0) {
        return illust.meta_pages.map((p) => p.image_urls.large);
    }
    return [illust.image_urls.large];
}

export type ListRecommendedParams = {
    type?: IllustType;
    includeRankingIllusts?: boolean;
    offset?: number;
};

export async function listRecommended(
    params: ListRecommendedParams = {},
): Promise<{ data: IllustPage | null; error: IllustApiError | null }> {
    const { data, error } = await api.GET("/illusts/recommended", {
        params: {
            query: {
                type: params.type,
                include_ranking_illusts: params.includeRankingIllusts,
                offset: params.offset,
            },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

export type ListFollowingIllustsParams = {
    restrict?: Restrict;
    offset?: number;
};

export async function listFollowingIllusts(
    params: ListFollowingIllustsParams = {},
): Promise<{ data: IllustPage | null; error: IllustApiError | null }> {
    const { data, error } = await api.GET("/illusts/following", {
        params: {
            query: {
                restrict: params.restrict,
                offset: params.offset,
            },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

// Infinite query factories for the home feeds (load-more UX). Both are offset-paged.
export function recommendedInfiniteQueryOptions(params: ListRecommendedParams) {
    return offsetInfiniteQueryOptions<IllustPage>({
        queryKey: ["recommended-infinite", params],
        fetchPage: (offset) => listRecommended({ ...params, offset }).then(unwrap),
    });
}

export function followingInfiniteQueryOptions(params: ListFollowingIllustsParams) {
    return offsetInfiniteQueryOptions<IllustPage>({
        queryKey: ["following-infinite", params],
        fetchPage: (offset) => listFollowingIllusts({ ...params, offset }).then(unwrap),
    });
}

export async function getBookmarkDetail(
    illustId: number,
): Promise<{ data: BookmarkDetail | null; error: IllustApiError | null }> {
    const { data, error } = await api.GET("/illusts/{id}/bookmark", {
        params: { path: { id: illustId } },
    });
    return { data: data ?? null, error: error ?? null };
}

export async function addBookmark(
    illustId: number,
    restrict: Restrict = "public",
): Promise<{ error: IllustApiError | null }> {
    const { error } = await api.PUT("/illusts/{id}/bookmark", {
        params: { path: { id: illustId } },
        body: { restrict },
    });
    return { error: error ?? null };
}

export async function deleteBookmark(illustId: number): Promise<{ error: IllustApiError | null }> {
    const { error } = await api.DELETE("/illusts/{id}/bookmark", {
        params: { path: { id: illustId } },
    });
    return { error: error ?? null };
}

export async function getIllustDetail(
    illustId: number,
): Promise<{ data: IllustDetailResponse | null; error: IllustApiError | null }> {
    const { data, error } = await api.GET("/illusts/{id}", {
        params: { path: { id: illustId } },
    });
    return { data: data ?? null, error: error ?? null };
}

// Stable cache key for one illust's detail. Exported so the bookmark mutation can
// cancel this exact in-flight query before its optimistic write (see useIllustBookmark).
export function illustDetailQueryKey(illustId: number) {
    return ["illust-detail", illustId] as const;
}

// Detail query for the illust viewer. Opening from a card seeds it with the Illust
// we already hold so it renders instantly. We use `initialData` (not placeholderData)
// so the seed actually lands IN the cache — making the cache the single source the
// viewer renders from, so optimistic bookmark writes (which patch the cache) show up
// immediately instead of being shadowed by a placeholder. `initialDataUpdatedAt: 0`
// marks that seed already-stale so it still refetches on mount to backfill detail-only
// fields the list payload omits (meta_pages, meta_single_page.original_image_url).
// A cold deep-link (?illust=<id> on first load) has no seed and fetches normally.
export function illustDetailQueryOptions(illustId: number, seed?: Illust | null) {
    return queryOptions<IllustDetailResponse, IllustApiError>({
        queryKey: illustDetailQueryKey(illustId),
        queryFn: () => getIllustDetail(illustId).then(unwrap),
        initialData: seed ? { illust: seed } : undefined,
        initialDataUpdatedAt: 0,
        staleTime: 60_000,
    });
}
