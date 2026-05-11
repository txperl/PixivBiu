import type { ReactNode } from "react";
import { AuthProvider } from "@/features/auth";
import { DownloadsProvider } from "@/features/downloads";
import { EventStreamProvider } from "@/features/events";
import { LocaleProvider } from "@/i18n";

export function AppProviders({ children }: { children: ReactNode }) {
    return (
        <LocaleProvider>
            <AuthProvider>
                <EventStreamProvider>
                    <DownloadsProvider>{children}</DownloadsProvider>
                </EventStreamProvider>
            </AuthProvider>
        </LocaleProvider>
    );
}
