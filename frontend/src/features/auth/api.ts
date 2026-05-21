import { api, type components } from "@/lib/api";

export type AuthStatus = components["schemas"]["AuthStatus"];
export type AuthApiError = components["schemas"]["Error"];
export type OAuthStartResponse = components["schemas"]["OAuthStartResponse"];

export async function getAuthStatus(): Promise<{ data: AuthStatus | null; error: AuthApiError | null }> {
    const { data, error } = await api.GET("/auth/status");
    return { data: data ?? null, error: error ?? null };
}

export async function login(refreshToken: string): Promise<{ data: AuthStatus | null; error: AuthApiError | null }> {
    const { data, error } = await api.POST("/auth/login", {
        body: { refresh_token: refreshToken },
    });
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
    const { data, error } = await api.POST("/auth/oauth/exchange", {
        body: { state, code },
    });
    return { data: data ?? null, error: error ?? null };
}
