import type { components } from "@/lib/api";

export type ApiError = components["schemas"]["Error"];

export type FetchState<T> =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; data: T }
    | { status: "error"; error: ApiError };
