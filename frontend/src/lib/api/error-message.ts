import { useMessages } from "@/i18n";
import type { components } from "./schema.gen";

type ApiError = components["schemas"]["Error"];

// Locale-aware replacement. useMessages() subscribes the calling component to
// locale changes, so the returned resolver re-renders into the active locale.
// The map is rebuilt on each call (after const m = useMessages()) and uses an
// explicit static map of the 8 backend codes (internal/api/handler.go::classify)
// to m.error_* functions — never m[dynamicKey]() — so tree-shaking and types
// stay intact. Unknown codes fall back to the raw error.message.
export function useApiErrorMessage(): (error: ApiError) => string {
    const m = useMessages();
    const map: Record<string, () => string> = {
        unauthenticated: () => m.error_unauthenticated(),
        bad_request: () => m.error_bad_request(),
        not_found: () => m.error_not_found(),
        conflict: () => m.error_conflict(),
        rate_limited: () => m.error_rate_limited(),
        forbidden: () => m.error_forbidden(),
        upstream_error: () => m.error_upstream_error(),
        internal_error: () => m.error_internal_error(),
    };
    return (error: ApiError) => map[error.code]?.() ?? error.message;
}
