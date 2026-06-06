import { queryOptions } from "@tanstack/react-query";
import { api, type components, unwrap } from "@/lib/api";
import { keepPreviousPage } from "@/lib/query/keep-previous-page";

export type Restrict = components["schemas"]["Restrict"];
export type UserApiError = components["schemas"]["Error"];
export type UserDetailPage = components["schemas"]["UserDetailPage"];
export type UserIllustsPage = components["schemas"]["UserIllustsPage"];
export type UserPreviewPage = components["schemas"]["UserPreviewPage"];
export type IllustPage = components["schemas"]["IllustPage"];

export const USER_PAGE_SIZE = 30;

export type UserIllustsType = "illust" | "manga";

export async function getUser(userId: number): Promise<{ data: UserDetailPage | null; error: UserApiError | null }> {
    const { data, error } = await api.GET("/users/{id}", {
        params: { path: { id: userId } },
    });
    return { data: data ?? null, error: error ?? null };
}

export type ListUserIllustsParams = {
    userId: number;
    type?: UserIllustsType;
    offset?: number;
};

export async function listUserIllusts(
    params: ListUserIllustsParams,
): Promise<{ data: UserIllustsPage | null; error: UserApiError | null }> {
    const { data, error } = await api.GET("/users/{id}/illusts", {
        params: {
            path: { id: params.userId },
            query: { type: params.type, offset: params.offset },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

export type ListUserBookmarksParams = {
    userId: number;
    restrict?: Restrict;
    tag?: string;
    maxBookmarkId?: number;
};

export async function listUserBookmarks(
    params: ListUserBookmarksParams,
): Promise<{ data: IllustPage | null; error: UserApiError | null }> {
    const { data, error } = await api.GET("/users/{id}/bookmarks", {
        params: {
            path: { id: params.userId },
            query: {
                restrict: params.restrict,
                tag: params.tag,
                max_bookmark_id: params.maxBookmarkId,
            },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

export type ListUserFollowingParams = {
    userId: number;
    restrict?: Restrict;
    offset?: number;
};

export async function listUserFollowing(
    params: ListUserFollowingParams,
): Promise<{ data: UserPreviewPage | null; error: UserApiError | null }> {
    const { data, error } = await api.GET("/users/{id}/following", {
        params: {
            path: { id: params.userId },
            query: { restrict: params.restrict, offset: params.offset },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

// Query factories (see AGENTS.md "Data fetching"). illust/manga/following are
// offset-paged; bookmarks are cursor-paged (`max_bookmark_id`) — the cursor is the
// param, so the key is pure server identity and each page/restrict/tag is its own
// cache entry. The page→cursor chain lives in the user page (a forward-only cursor
// can only be walked, never computed), which feeds the resolved cursor in here.
export function userDetailQueryOptions(userId: number) {
    return queryOptions<UserDetailPage, UserApiError>({
        queryKey: ["user-detail", userId],
        queryFn: () => getUser(userId).then(unwrap),
    });
}

export function userIllustsQueryOptions(params: ListUserIllustsParams) {
    return queryOptions<UserIllustsPage, UserApiError>({
        queryKey: ["user-illusts", params],
        queryFn: () => listUserIllusts(params).then(unwrap),
        // Keep the prior page during a page jump, but not across a user/tab change.
        placeholderData: keepPreviousPage(params, ["offset"]),
    });
}

export function userFollowingQueryOptions(params: ListUserFollowingParams) {
    return queryOptions<UserPreviewPage, UserApiError>({
        queryKey: ["user-following", params],
        queryFn: () => listUserFollowing(params).then(unwrap),
        placeholderData: keepPreviousPage(params, ["offset"]),
    });
}

export function userBookmarksQueryOptions(params: ListUserBookmarksParams) {
    return queryOptions<IllustPage, UserApiError>({
        queryKey: ["user-bookmarks", params],
        queryFn: () => listUserBookmarks(params).then(unwrap),
        // Cursor-paged: keep the prior page across a maxBookmarkId step, but not across a
        // user/restrict/tag change (a different bookmark list).
        placeholderData: keepPreviousPage(params, ["maxBookmarkId"]),
    });
}

export async function addFollow(
    userId: number,
    restrict: Restrict = "public",
): Promise<{ error: UserApiError | null }> {
    const { error } = await api.PUT("/users/{id}/follow", {
        params: { path: { id: userId } },
        body: { restrict },
    });
    return { error: error ?? null };
}

export async function deleteFollow(userId: number): Promise<{ error: UserApiError | null }> {
    const { error } = await api.DELETE("/users/{id}/follow", {
        params: { path: { id: userId } },
    });
    return { error: error ?? null };
}
