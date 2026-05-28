import { api, type components } from "@/lib/api";
import type { ConfigSchema } from "./types";

export type ConfigView = components["schemas"]["ConfigView"];
export type ConfigSource = components["schemas"]["ConfigSource"];
export type ConfigApiError = components["schemas"]["Error"];

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
