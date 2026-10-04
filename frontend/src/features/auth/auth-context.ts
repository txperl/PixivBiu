import { createContext, type RefObject } from "react";
import type { AuthApiError, AuthStatus, OAuthStartResponse } from "./api";

export interface AuthContextValue {
    status: AuthStatus | null;
    session: RefObject<{ key: string; generation: number; signal: AbortSignal }>;
    pending: boolean;
    refresh: () => Promise<AuthApiError | null>;
    login: (refreshToken: string) => Promise<AuthApiError | null>;
    logout: () => Promise<AuthApiError | null>;
    startOAuth: () => Promise<{ data: OAuthStartResponse | null; error: AuthApiError | null }>;
    exchangeOAuth: (state: string, code: string) => Promise<AuthApiError | null>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
