import type { ReactNode } from "react";
import { AuthProvider } from "@/features/auth";
import { LocaleProvider } from "@/i18n";

export function AppProviders({ children }: { children: ReactNode }) {
    return (
        <LocaleProvider>
            <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
    );
}
