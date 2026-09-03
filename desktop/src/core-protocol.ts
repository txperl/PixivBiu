import { net, protocol } from "electron";
import {
    APP_CONTENT_SECURITY_POLICY,
    CORE_SCHEME,
    isTrustedCoreURL,
} from "./security";

// The renderer loads the SPA from this stable custom origin instead of the
// core's loopback URL. The core binds a fresh ephemeral port every launch, and
// web storage (localStorage, IndexedDB, …) is partitioned per origin including
// the port — loading http://127.0.0.1:<port> directly would hand the SPA an
// empty storage bucket on every run. pixivbiu://core decouples the origin from
// the port entirely: the port stays a private main-process detail, and if a
// future watchdog respawns the core on a new port the page keeps its origin
// and self-heals (API retries, EventSource auto-reconnect).
export { CORE_BASE_URL, CORE_ORIGIN } from "./security";

function secureHeaders(source?: HeadersInit): Headers {
    const headers = new Headers(source);
    headers.set("Content-Security-Policy", APP_CONTENT_SECURITY_POLICY);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "no-referrer");
    return headers;
}

function errorResponse(message: string, status: number): Response {
    return new Response(message, {
        status,
        headers: secureHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
    });
}

// Must run before app.whenReady() (Electron requirement).
export function registerCoreScheme(): void {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: CORE_SCHEME,
            privileges: {
                standard: true, // host+path URL parsing → relative URLs and per-origin storage work
                secure: true, // secure context → navigator.clipboard stays available
                supportFetchAPI: true, // renderer fetch() and EventSource
                stream: true, // pass streaming bodies through without buffering (SSE, images)
                corsEnabled: true,
                codeCache: true,
            },
        },
    ]);
}

// Call after app.whenReady(). getPort is read per request so a respawned core
// on a different port is picked up without reinstalling the handler.
export function installCoreProtocol(getPort: () => number | null): void {
    protocol.handle(CORE_SCHEME, async (request) => {
        const url = new URL(request.url);
        if (!isTrustedCoreURL(request.url)) return errorResponse("not found", 404);
        const port = getPort();
        if (port === null) return errorResponse("core unavailable", 503);
        // Strip headers that describe the renderer's request before forwarding;
        // net.fetch builds its own. An Origin of pixivbiu://core makes net.fetch
        // treat the loopback request as cross-origin and fail CORS
        // (net::ERR_FAILED) since the core sends no CORS headers. A forwarded
        // Content-Length clashes with the chunked encoding net.fetch uses for
        // streamed bodies, leaving the core waiting for bytes that never come
        // (POST/PATCH hang forever). App headers like X-PixivBiu-App pass
        // through untouched.
        const headers = new Headers(request.headers);
        for (const name of ["origin", "content-length", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest", "sec-fetch-user"]) {
            headers.delete(name);
        }
        try {
            // Electron (≤34 at least) never aborts request.signal when the
            // renderer cancels — a directly returned net.fetch Response then
            // holds its upstream connection open forever. For SSE that both
            // accumulates dead hub subscriptions in the core and exhausts
            // Chromium's 6-connections-per-host pool, starving later requests.
            // Wrapping the body in our own stream restores cancellation: the
            // consumer's cancel() does fire, and we abort the upstream there.
            // request.signal is wired too for Electron versions that fix it.
            const upstreamCtrl = new AbortController();
            request.signal.addEventListener("abort", () => upstreamCtrl.abort());
            const upstream = await net.fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
                method: request.method,
                headers,
                body: request.body,
                duplex: "half", // required when body is a ReadableStream
                signal: upstreamCtrl.signal,
                bypassCustomProtocolHandlers: true,
            } as RequestInit); // duplex isn't in lib.dom's RequestInit yet
            const responseHeaders = secureHeaders(upstream.headers);
            if (!upstream.body) {
                return new Response(null, {
                    status: upstream.status,
                    statusText: upstream.statusText,
                    headers: responseHeaders,
                });
            }
            const reader = upstream.body.getReader();
            const body = new ReadableStream({
                async pull(controller) {
                    try {
                        const { done, value } = await reader.read();
                        if (done) controller.close();
                        else controller.enqueue(value);
                    } catch (err) {
                        controller.error(err);
                    }
                },
                cancel() {
                    upstreamCtrl.abort();
                },
            });
            return new Response(body, {
                status: upstream.status,
                statusText: upstream.statusText,
                headers: responseHeaders,
            });
        } catch (err) {
            // Core died mid-flight: a non-ok status lets the SPA's error
            // normalization surface its localized failure state.
            console.error("[core-protocol]", request.method, request.url, err);
            return errorResponse("core unreachable", 502);
        }
    });
}
