import { useMessages } from "@/i18n";
import type { components } from "./schema.gen";

type ApiError = components["schemas"]["Error"];

// The backend's `kind` field carries the safety contract for `message`.
// When `kind === "app"`, a non-empty `message` is authored text
// (UserError opt-in / frontend synthetic) and is rendered as-is.
// Otherwise — including for sentinel app errors that send an empty
// message — we localize via `upstream.reason` (when relevant) then by
// `code`, falling back to `error.message` only if no key is registered.
export function useApiErrorMessage(): (error: ApiError) => string {
    const m = useMessages();
    const byCode: Record<string, () => string> = {
        unauthenticated: () => m.error_unauthenticated(),
        bad_request: () => m.error_bad_request(),
        not_found: () => m.error_not_found(),
        conflict: () => m.error_conflict(),
        rate_limited: () => m.error_rate_limited(),
        forbidden: () => m.error_forbidden(),
        upstream_error: () => m.error_upstream_error(),
        internal_error: () => m.error_internal_error(),
    };
    const byUpstreamReason: Record<string, () => string> = {
        invalid_grant: () => m.error_upstream_invalid_grant(),
        rate_limit: () => m.error_upstream_rate_limit(),
    };
    return (error) => {
        if (error.kind === "app" && error.message) return error.message;
        const reason = error.kind === "upstream" ? error.upstream?.reason : undefined;
        return byUpstreamReason[reason ?? ""]?.() ?? byCode[error.code]?.() ?? error.message;
    };
}
