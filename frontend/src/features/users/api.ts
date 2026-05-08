import { api, type components } from "@/lib/api";

export type Restrict = components["schemas"]["Restrict"];
export type UserApiError = components["schemas"]["Error"];

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
