import { api, type components } from "@/lib/api";

export type Restrict = components["schemas"]["Restrict"];
export type IllustApiError = components["schemas"]["Error"];

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
