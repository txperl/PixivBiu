import { api, type components, unwrap } from "@/lib/api";
import { offsetInfiniteQueryOptions } from "@/lib/query/offset-infinite-query-options";

export type Restrict = components["schemas"]["Restrict"];
export type IllustType = components["schemas"]["IllustType"];
export type BookmarkDetail = components["schemas"]["BookmarkDetail"];
export type Illust = components["schemas"]["Illust"];
export type IllustPage = components["schemas"]["IllustPage"];
export type IllustApiError = components["schemas"]["Error"];

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
