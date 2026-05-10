import { api, type components } from "@/lib/api";

export type Restrict = components["schemas"]["Restrict"];
export type BookmarkDetail = components["schemas"]["BookmarkDetail"];
export type IllustApiError = components["schemas"]["Error"];

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
