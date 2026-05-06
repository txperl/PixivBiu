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
            return { code: "invalid_argument", message: "Refresh token is required" } satisfies AuthApiError;
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

    const value = useMemo<AuthContextValue>(
        () => ({ status, pending, refresh, login, logout }),
        [status, pending, refresh, login, logout],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
