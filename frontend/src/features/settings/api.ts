import { api, type components } from "@/lib/api";
import type { ConfigSchema } from "./types";

export type ConfigView = components["schemas"]["ConfigView"];
export type ConfigSource = components["schemas"]["ConfigSource"];
export type ConfigApiError = components["schemas"]["Error"];
export type I18nStatus = components["schemas"]["I18nStatus"];

type Result<T> = { data: T | null; error: ConfigApiError | null };

export async function getConfig(): Promise<Result<ConfigView>> {
    const { data, error } = await api.GET("/config");
    return { data: data ?? null, error: error ?? null };
}

// getI18n returns the backend's currently-bound language pair:
// `configured` mirrors `app.language` (may be "auto"); `locale` is the
// concrete locale the running process resolved. The frontend's
// LocaleProvider uses this to mirror the backend — it never sniffs
// navigator.language on its own.
export async function getI18n(): Promise<Result<I18nStatus>> {
    const { data, error } = await api.GET("/i18n");
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
