import {
    type InfiniteData,
    infiniteQueryOptions,
    type QueryClient,
    type QueryKey,
    queryOptions,
} from "@tanstack/react-query";
import { listUserBookmarkTags } from "@/features/users/api";
import { type ApiError, type components, unwrap } from "@/lib/api";
import { SKIP_LIST_INVALIDATION } from "@/lib/query/use-invalidate-illust-lists";
import { type BookmarkDetail, getBookmarkDetail, type Restrict } from "./api";

export const MAX_BOOKMARK_TAGS = 10;
export type BookmarkStatus = "none" | Restrict;
export type BookmarkStatusState =
    | { phase: "loading" | "error" }
    | { phase: "ready"; value: BookmarkStatus; disabled: boolean };

export function registeredBookmarkTags(detail: BookmarkDetail | undefined) {
    return detail?.is_bookmarked ? detail.tags.filter((tag) => tag.is_registered).map((tag) => tag.name) : [];
}

export function bookmarkStatus(detail: BookmarkDetail): BookmarkStatus {
    return detail.is_bookmarked ? detail.restrict : "none";
}

export function normalizeBookmarkTags(tags: readonly string[]) {
    return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
export function validBookmarkTags(tags: readonly string[]) {
    return tags.length <= MAX_BOOKMARK_TAGS && tags.every((tag) => !/\s/u.test(tag));
}
// A collection reset changes the page behind the viewer, not the work being edited.
// Card editors still follow pagination; viewer editors follow the work and route.
export function bookmarkEditorNavigationIdentity(illustId: number, pathname: string, search: string) {
    const params = new URLSearchParams(search);
    if (Number(params.get("illust")) === illustId) params.delete("page");
    params.sort();
    return JSON.stringify([pathname, params.toString()]);
}
export const bookmarkDetailKey = (account: string, id: number) => ["bookmark-detail", account, id] as const;
export function bookmarkDetailOptions(account: string, id: number) {
    return queryOptions<BookmarkDetail, ApiError>({
        queryKey: bookmarkDetailKey(account, id),
        queryFn: ({ signal }) => getBookmarkDetail(id, signal).then(unwrap),
        meta: SKIP_LIST_INVALIDATION,
        refetchOnMount: true,
    });
}
export function bookmarkTagsOptions(userId: number, restrict: Restrict) {
    return infiniteQueryOptions<
        components["schemas"]["BookmarkTagsPage"],
        ApiError,
        InfiniteData<components["schemas"]["BookmarkTagsPage"], number>,
        QueryKey,
        number
    >({
        queryKey: ["bookmark-tags", userId, restrict] as const,
        initialPageParam: 0,
        queryFn: ({ pageParam, signal }) => listUserBookmarkTags(userId, restrict, pageParam, signal).then(unwrap),
        getNextPageParam: (last, _pages, lastParam) =>
            last.next_offset != null && last.next_offset > lastParam ? last.next_offset : undefined,
        meta: SKIP_LIST_INVALIDATION,
    });
}
export const bookmarkRevisionKey = (userId: number, restrict: Restrict, tag: string) =>
    ["bookmark-revision", userId, restrict, tag] as const;
// Only lists whose membership may have changed need a new cursor chain.
export function invalidateBookmarkMembership(
    client: QueryClient,
    userId: number,
    before: BookmarkDetail | undefined,
    after: BookmarkDetail | undefined,
) {
    const belongs = (detail: BookmarkDetail | undefined, restrict: string, tag: string) =>
        detail == null
            ? undefined
            : detail.is_bookmarked &&
              detail.restrict === restrict &&
              (!tag || detail.tags.some((entry) => entry.is_registered && entry.name === tag));
    for (const query of client.getQueryCache().findAll({ queryKey: ["bookmark-revision", userId] })) {
        const restrict = String(query.queryKey[2]);
        const tag = String(query.queryKey[3]);
        const was = belongs(before, restrict, tag);
        const now = belongs(after, restrict, tag);
        if (was == null || now == null || was !== now)
            client.setQueryData<number>(query.queryKey, (old) => (old ?? 0) + 1);
    }
}
export const knownTagsKey = (userId: number, restrict: Restrict) => ["bookmark-known-tags", userId, restrict] as const;
export function cachedStateOptions<T>(key: readonly unknown[], initial: T) {
    return queryOptions({
        queryKey: key,
        queryFn: ({ client }) => client.getQueryData<T>(key) ?? initial,
        initialData: initial,
        staleTime: Infinity,
        meta: SKIP_LIST_INVALIDATION,
    });
}
export function rememberBookmarkTags(client: QueryClient, userId: number, restrict: Restrict, tags: readonly string[]) {
    client.setQueryData<string[]>(knownTagsKey(userId, restrict), (old) =>
        normalizeBookmarkTags([...(old ?? []), ...tags]),
    );
}
