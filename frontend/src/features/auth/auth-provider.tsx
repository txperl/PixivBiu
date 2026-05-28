import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { AuthApiError, AuthStatus } from "./api";
import * as authApi from "./api";
import { AuthContext, type AuthContextValue } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AuthStatus | null>(null);
    const [pending, setPending] = useState(false);

    const refresh = useCallback(async () => {
        const { data, error } = await authApi.getAuthStatus();
        if (error) return error;
        setStatus(data);
        return null;
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const login = useCallback(async (refreshToken: string) => {
        const trimmed = refreshToken.trim();
        if (!trimmed) {
            return { code: "bad_request", kind: "app", message: "Refresh token is required" } satisfies AuthApiError;
        }
        setPending(true);
        const { data, error } = await authApi.login(trimmed);
        setPending(false);
        if (error) return error;
        setStatus(data);
        return null;
    }, []);

    const logout = useCallback(async () => {
        setPending(true);
        const { error } = await authApi.logout();
        setPending(false);
        if (error) return error;
        return await refresh();
    }, [refresh]);

    const startOAuth = useCallback(async () => {
        setPending(true);
        const result = await authApi.startOAuth();
        setPending(false);
        return result;
    }, []);

    const exchangeOAuth = useCallback(async (state: string, code: string) => {
        const trimmedState = state.trim();
        const trimmedCode = code.trim();
        if (!trimmedState || !trimmedCode) {
            return { code: "bad_request", kind: "app", message: "State and code are required" } satisfies AuthApiError;
        }
        setPending(true);
        const { data, error } = await authApi.exchangeOAuth(trimmedState, trimmedCode);
        setPending(false);
        if (error) return error;
        setStatus(data);
        return null;
    }, []);

    const value = useMemo<AuthContextValue>(
        () => ({ status, pending, refresh, login, logout, startOAuth, exchangeOAuth }),
        [status, pending, refresh, login, logout, startOAuth, exchangeOAuth],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
