import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActivityBarProvider } from "@/features/activity-bar";
import { AuthProvider, useAuth } from "@/features/auth";
import { DownloadStateProvider } from "@/features/downloads";
import { EventStreamProvider } from "@/features/events";
import { LocaleProvider, LocaleSync } from "@/i18n";

// Bridges AuthProvider and LocaleProvider without coupling either to the
// other — both need to stay independently mountable. See <LocaleSync>.
function AuthGatedLocaleSync() {
    const { status } = useAuth();
    return <LocaleSync authenticated={!!status?.authenticated} />;
}

export function AppProviders({ children }: { children: ReactNode }) {
    return (
        <TooltipProvider delay={300}>
            <LocaleProvider>
                <AuthProvider>
                    <AuthGatedLocaleSync />
                    <EventStreamProvider>
                        <DownloadStateProvider>
                            <ActivityBarProvider>{children}</ActivityBarProvider>
                        </DownloadStateProvider>
                    </EventStreamProvider>
                </AuthProvider>
            </LocaleProvider>
        </TooltipProvider>
    );
}
