import { createContext } from "react";
import type { AuthApiError, AuthStatus } from "./api";

export interface AuthContextValue {
    status: AuthStatus | null;
    pending: boolean;
    refresh: () => Promise<AuthApiError | null>;
    login: (refreshToken: string) => Promise<AuthApiError | null>;
    logout: () => Promise<AuthApiError | null>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
