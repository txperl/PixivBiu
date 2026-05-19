import { api, type components } from "@/lib/api";

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
