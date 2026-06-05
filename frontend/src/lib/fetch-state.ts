import type { ApiError } from "@/lib/api";

// Re-exported for back-compat; the canonical definition lives in lib/api/unwrap.
export type { ApiError };

export type FetchState<T> =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; data: T }
    | { status: "error"; error: ApiError };
