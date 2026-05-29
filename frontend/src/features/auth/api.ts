import { api, call, type components } from "@/lib/api";

export type AuthStatus = components["schemas"]["AuthStatus"];
export type AuthApiError = components["schemas"]["Error"];
export type OAuthStartResponse = components["schemas"]["OAuthStartResponse"];
export type ConnectivityStatus = components["schemas"]["ConnectivityStatus"];

// Every wrapper routes through `call`, which guarantees a failed request — a
// non-2xx, an empty/torn response, or a thrown fetch — can never read back as
// success. See lib/api/result.ts.

export function getAuthStatus(): Promise<{ data: AuthStatus | null; error: AuthApiError | null }> {
    return call(() => api.GET("/auth/status"));
}

export function login(refreshToken: string): Promise<{ data: AuthStatus | null; error: AuthApiError | null }> {
    return call(() => api.POST("/auth/login", { body: { refresh_token: refreshToken } }));
}

export function logout(): Promise<{ error: AuthApiError | null }> {
    return call(() => api.POST("/auth/logout"));
}

export function startOAuth(): Promise<{ data: OAuthStartResponse | null; error: AuthApiError | null }> {
    return call(() => api.POST("/auth/oauth/start"));
}

export function exchangeOAuth(
    state: string,
    code: string,
): Promise<{ data: AuthStatus | null; error: AuthApiError | null }> {
    return call(() => api.POST("/auth/oauth/exchange", { body: { state, code } }));
}

// checkConnectivity probes whether the backend can reach Pixiv. Omit `proxy` to
// test the current configuration; pass one to test (and, on success, persist) a
// candidate proxy. `reachable: false` is a normal result, not an `error`: it
// arrives on a 200, so `call` keeps it on the data path.
export function checkConnectivity(
    proxy?: string,
): Promise<{ data: ConnectivityStatus | null; error: AuthApiError | null }> {
    return call(() => api.POST("/auth/connectivity", { body: proxy === undefined ? undefined : { proxy } }));
}
