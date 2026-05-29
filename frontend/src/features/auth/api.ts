import { api, type components } from "@/lib/api";

export type AuthStatus = components["schemas"]["AuthStatus"];
export type AuthApiError = components["schemas"]["Error"];
export type OAuthStartResponse = components["schemas"]["OAuthStartResponse"];
export type ConnectivityStatus = components["schemas"]["ConnectivityStatus"];

// The empty/non-2xx/thrown-response guard lives in the lib/api/client.ts
// middleware, so a failed request can never read back as success here.

export async function getAuthStatus(): Promise<{ data: AuthStatus | null; error: AuthApiError | null }> {
    const { data, error } = await api.GET("/auth/status");
    return { data: data ?? null, error: error ?? null };
}

export async function login(refreshToken: string): Promise<{ data: AuthStatus | null; error: AuthApiError | null }> {
    const { data, error } = await api.POST("/auth/login", { body: { refresh_token: refreshToken } });
    return { data: data ?? null, error: error ?? null };
}

export async function logout(): Promise<{ error: AuthApiError | null }> {
    const { error } = await api.POST("/auth/logout");
    return { error: error ?? null };
}

export async function startOAuth(): Promise<{ data: OAuthStartResponse | null; error: AuthApiError | null }> {
    const { data, error } = await api.POST("/auth/oauth/start");
    return { data: data ?? null, error: error ?? null };
}

export async function exchangeOAuth(
    state: string,
    code: string,
): Promise<{ data: AuthStatus | null; error: AuthApiError | null }> {
    const { data, error } = await api.POST("/auth/oauth/exchange", { body: { state, code } });
    return { data: data ?? null, error: error ?? null };
}

// checkConnectivity probes whether the backend can reach Pixiv. Omit `proxy` to
// test the current configuration; pass one to test (and, on success, persist) a
// candidate proxy. `reachable: false` is a normal result, not an `error`: it
// arrives on a 200, so the middleware leaves it on the data path.
export async function checkConnectivity(
    proxy?: string,
): Promise<{ data: ConnectivityStatus | null; error: AuthApiError | null }> {
    const { data, error } = await api.POST("/auth/connectivity", {
        body: proxy === undefined ? undefined : { proxy },
    });
    return { data: data ?? null, error: error ?? null };
}
