import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuthApiError, AuthStatus } from "./api";
import * as authApi from "./api";
import { AuthContext, type AuthContextValue } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<AuthStatus | null>(null);
    const [pending, setPending] = useState(false);
    const sessionController = useRef(new AbortController());
    const session = useRef({ key: "loading", generation: 0, signal: sessionController.current.signal });
    const sessionKey =
        status == null ? "loading" : !status.authenticated ? "anon" : `user:${status.user_id ?? "unknown"}`;
    if (session.current.key !== sessionKey) {
        sessionController.current = new AbortController();
        session.current = {
            key: sessionKey,
            generation: session.current.generation + 1,
            signal: sessionController.current.signal,
        };
    }
    const controller = sessionController.current;
    useEffect(() => () => controller.abort(), [controller]);

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
        () => ({ status, session, pending, refresh, login, logout, startOAuth, exchangeOAuth }),
        [status, pending, refresh, login, logout, startOAuth, exchangeOAuth],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
