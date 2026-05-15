import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth";
import { DownloadStateProvider } from "@/features/downloads";
import { EventStreamProvider } from "@/features/events";
import { LocaleProvider } from "@/i18n";

export function AppProviders({ children }: { children: ReactNode }) {
    return (
        <TooltipProvider delay={300}>
            <LocaleProvider>
                <AuthProvider>
                    <EventStreamProvider>
                        <DownloadStateProvider>{children}</DownloadStateProvider>
                    </EventStreamProvider>
                </AuthProvider>
            </LocaleProvider>
        </TooltipProvider>
    );
}
