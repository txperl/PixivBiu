import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type components } from "@/lib/api";

type AuthStatus = components["schemas"]["AuthStatus"];
type ApiError = components["schemas"]["Error"];

interface AuthContextValue {
    status: AuthStatus | null;
    pending: boolean;
    refresh: () => Promise<ApiError | null>;
    login: (refreshToken: string) => Promise<ApiError | null>;
    logout: () => Promise<ApiError | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AuthStatus | null>(null);
    const [pending, setPending] = useState(false);

    const refresh = useCallback(async () => {
        const { data, error: err } = await api.GET("/auth/status");
        if (err) return err;
        setStatus(data);
        return null;
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const login = useCallback(async (refreshToken: string) => {
        const trimmed = refreshToken.trim();
        if (!trimmed) {
            return { code: "invalid_argument", message: "Refresh token is required" } satisfies ApiError;
        }
        setPending(true);
        const { data, error: err } = await api.POST("/auth/login", {
            body: { refresh_token: trimmed },
        });
        setPending(false);
        if (err) return err;
        setStatus(data);
        return null;
    }, []);

    const logout = useCallback(async () => {
        setPending(true);
        const { error: err } = await api.POST("/auth/logout");
        setPending(false);
        if (err) return err;
        return await refresh();
    }, [refresh]);

    const value = useMemo<AuthContextValue>(
        () => ({ status, pending, refresh, login, logout }),
        [status, pending, refresh, login, logout],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
    return ctx;
}
