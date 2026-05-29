import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema.gen";

export const api = createClient<paths>({ baseUrl: "/api/v1" });

// SYNTHETIC is the error we surface when the backend gives us nothing usable.
// The frontend localizes `internal_error`.
const SYNTHETIC: components["schemas"]["Error"] = { code: "internal_error", kind: "internal", message: "" };

function syntheticResponse(status: number): Response {
    // Build via `new Response(...)`, not `Response.json`, for broad compatibility.
    return new Response(JSON.stringify(SYNTHETIC), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

// openapi-fetch returns `{ error: undefined }` for any response with an empty
// body (`Content-Length: 0`) or a 204 — even when it's a non-2xx. Callers do
// `error ?? null` → null → and advance as if the request succeeded. That is the
// bug this middleware guards: a dead/unreachable backend, or a torn/empty 5xx
// from the dev proxy, must never read back as success.
//
// Running here (before the empty-body short-circuit, and on EVERY request)
// means all feature modules are protected for free, with no per-call wrapper.
const errorNormalization: Middleware = {
    async onResponse({ response }) {
        // Leave every success untouched: this keeps checkConnectivity's
        // 200-with-{reachable:false} and any genuine 204 working.
        if (response.ok) return undefined;

        // Peek without consuming the original — `clone()` so openapi-fetch can
        // still parse the real body. The clone+read only runs on the non-ok
        // path, where bodies are tiny. If the read itself rejects (connection
        // dropped mid-body after the header arrived), fall back to "" so we
        // synthesize below: openapi-fetch funnels only fetch() throws through
        // onError, NOT onResponse, so an escaped rejection here would bypass the
        // guard and hang the caller (the old per-call catch is gone).
        const body = await response
            .clone()
            .text()
            .catch(() => "");

        // A real structured error body ({code,kind,...}) passes through so
        // openapi-fetch parses it: invalid_grant / rate_limit / upstream.reason
        // localization all depend on the original payload, so never clobber it.
        if (body.trim() !== "") return undefined;

        // Empty or unreadable body on a non-2xx (and non-204, which short-
        // circuits anyway): substitute a non-empty synthetic body so openapi-
        // fetch parses it into `error` instead of returning `error: undefined`.
        return syntheticResponse(response.status);
    },
    onError() {
        // `fetch` itself threw (backend unreachable / connection reset).
        // Returning a Response recovers it into a normal non-ok `{ error }`
        // result instead of a rejected promise. Control then falls through into
        // onResponse, which leaves this non-empty synthetic body alone. The 503
        // is arbitrary — callers localize by `code`, never by HTTP status; only
        // its non-ok-ness matters, so openapi-fetch routes it to the error path.
        return syntheticResponse(503);
    },
};

api.use(errorNormalization);
