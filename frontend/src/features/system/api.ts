import { api, type components } from "@/lib/api";

export type UpdateStatus = components["schemas"]["UpdateStatus"];
export type SystemVersion = components["schemas"]["SystemVersion"];
export type UpdateApiError = components["schemas"]["Error"];

type Result<T> = { data: T | null; error: UpdateApiError | null };

export async function getSystemVersion(): Promise<Result<SystemVersion>> {
    const { data, error } = await api.GET("/system/version");
    return { data: data ?? null, error: error ?? null };
}

// Cached status — no network call to GitHub, no auth required.
export async function getUpdateStatus(): Promise<Result<UpdateStatus>> {
    const { data, error } = await api.GET("/system/update");
    return { data: data ?? null, error: error ?? null };
}

// Forces a fresh check against GitHub (requires auth).
export async function checkForUpdate(): Promise<Result<UpdateStatus>> {
    const { data, error } = await api.POST("/system/update/check");
    return { data: data ?? null, error: error ?? null };
}

// Downloads + verifies + applies the update, then the server restarts. The
// 202 body is ignored; callers wait for the new binary to come back up.
export async function applyUpdate(): Promise<{ error: UpdateApiError | null }> {
    const { error } = await api.POST("/system/update/apply");
    return { error: error ?? null };
}
