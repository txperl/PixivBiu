import type { components } from "./schema.gen";

type ApiError = components["schemas"]["Error"];

// openapi-fetch returns `error: undefined` for any response with an empty body
// — a 204, or (crucially) the torn/empty 5xx a dead upstream or dev proxy
// yields when the backend hangs and the connection is cut. Left as-is that
// reads as "no error", so callers advance as if the call succeeded. SYNTHETIC
// is what we surface instead; the frontend localizes `internal_error`.
const SYNTHETIC: ApiError = { code: "internal_error", kind: "internal", message: "" };

// call wraps an openapi-fetch invocation and normalizes its
// `{ data?, error?, response }` triple into `{ data, error }`, guaranteeing a
// failed request can never be mistaken for a successful one:
//   - a parsed error body passes through unchanged;
//   - a non-2xx with no parsed body (empty / 204 / undocumented status) and a
//     thrown fetch (backend down, connection reset) both become an error;
//   - only a genuine 2xx yields `error: null` (with `data` possibly null when
//     the body is empty, e.g. 204 — a legitimate success).
export async function call<T>(
    fn: () => Promise<{ data?: T; error?: ApiError; response: Response }>,
): Promise<{ data: T | null; error: ApiError | null }> {
    try {
        const { data, error, response } = await fn();
        if (error != null) return { data: null, error };
        if (!response.ok) return { data: null, error: SYNTHETIC };
        return { data: data ?? null, error: null };
    } catch {
        return { data: null, error: SYNTHETIC };
    }
}
