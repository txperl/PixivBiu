import { api, type components } from "@/lib/api";
import type { ConfigSchema } from "./types";

export type ConfigView = components["schemas"]["ConfigView"];
export type ConfigSource = components["schemas"]["ConfigSource"];
export type ConfigApiError = components["schemas"]["Error"];
export type NamingPreviewRequest = components["schemas"]["NamingPreviewRequest"];
export type NamingPreviewResponse = components["schemas"]["NamingPreviewResponse"];

type Result<T> = { data: T | null; error: ConfigApiError | null };

export async function getConfig(): Promise<Result<ConfigView>> {
    const { data, error } = await api.GET("/config");
    return { data: data ?? null, error: error ?? null };
}

export async function getConfigSchema(): Promise<Result<ConfigSchema>> {
    const { data, error } = await api.GET("/config/schema");
    return { data: (data as ConfigSchema) ?? null, error: error ?? null };
}

// Body keys may be flat dotted paths or nested; we always send flat. Values
// must match the schema leaf type exactly (number for ints, boolean for
// bools, string for strings/durations) — the backend rejects mismatches.
export async function patchConfig(body: Record<string, unknown>): Promise<Result<ConfigView>> {
    const { data, error } = await api.PATCH("/config", { body });
    return { data: data ?? null, error: error ?? null };
}

export async function resetConfig(req: { keys?: string[]; all?: boolean }): Promise<Result<ConfigView>> {
    const { data, error } = await api.POST("/config/reset", { body: req });
    return { data: data ?? null, error: error ?? null };
}

export async function restartConfig(): Promise<{ error: ConfigApiError | null }> {
    const { error } = await api.POST("/config/restart");
    return { error: error ?? null };
}

// Render the download naming templates against a fixed sample work for the
// live preview. Non-persisting; per-template parse/exec errors come back in
// `data.fields` on a 200, so a bad template mid-edit is data, not an error.
export async function previewNaming(body: NamingPreviewRequest): Promise<Result<NamingPreviewResponse>> {
    const { data, error } = await api.POST("/config/naming/preview", { body });
    return { data: data ?? null, error: error ?? null };
}
