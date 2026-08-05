import { net, protocol } from "electron";

// The renderer loads the SPA from this stable custom origin instead of the
// core's loopback URL. The core binds a fresh ephemeral port every launch, and
// web storage (localStorage, IndexedDB, …) is partitioned per origin including
// the port — loading http://127.0.0.1:<port> directly would hand the SPA an
// empty storage bucket on every run. pixivbiu://core decouples the origin from
// the port entirely: the port stays a private main-process detail, and if a
// future watchdog respawns the core on a new port the page keeps its origin
// and self-heals (API retries, EventSource auto-reconnect).
export const CORE_ORIGIN = "pixivbiu://core";
export const CORE_BASE_URL = `${CORE_ORIGIN}/`;

const CORE_SCHEME = "pixivbiu";

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
        if (url.host !== "core") return new Response("not found", { status: 404 });
        const port = getPort();
        if (port === null) return new Response("core unavailable", { status: 503 });
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
            if (!upstream.body) return upstream;
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
            return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
        } catch (err) {
            // Core died mid-flight: a non-ok status lets the SPA's error
            // normalization surface its localized failure state.
            console.error("[core-protocol]", request.method, request.url, err);
            return new Response("core unreachable", { status: 502 });
        }
    });
}
