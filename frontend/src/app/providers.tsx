import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActivityBarProvider } from "@/features/activity-bar";
import { AuthProvider, type AuthStatus, useAuth } from "@/features/auth";
import { DownloadStateProvider } from "@/features/downloads";
import { EventStreamProvider } from "@/features/events";
import { UpdateProvider } from "@/features/system";
import { LocaleProvider, LocaleSync } from "@/i18n";
import { queryClient } from "@/lib/query/client";

// Bridges AuthProvider and LocaleProvider without coupling either to the
// other — both need to stay independently mountable. See <LocaleSync>.
function AuthGatedLocaleSync() {
    const { status } = useAuth();
    return <LocaleSync authenticated={!!status?.authenticated} />;
}

// Identity of the signed-in session, used to scope the query cache. Keeps
// "authenticated but user_id unknown" (the schema allows `user_id` to be absent;
// a persisted token with UserID 0 produces it) distinct from "logged out" and
// from the pre-resolve "loading" state — collapsing the id-unknown case onto the
// logged-out key would make its logout a no-op transition and leak its cache.
function sessionKey(status: AuthStatus | null): string {
    if (status == null) return "loading";
    if (!status.authenticated) return "anon";
    return status.user_id != null ? `user:${status.user_id}` : "auth";
}

// Clears the React Query cache when the signed-in session changes. The singleton
// QueryClient sits above AuthProvider, so without this a logout → login as a
// different Pixiv account would reuse the previous account's cached lists
// (per-account fields like is_bookmarked/is_muted survive for up to gcTime).
// Fires only when LEAVING an authenticated session (logout/switch — a session
// with no user_id still clears on its authenticated → anon logout), so the
// cold-login resolve and a freshly warmed boot cache are left intact.
function AuthGatedQueryReset() {
    const { status } = useAuth();
    const queryClient = useQueryClient();
    const key = sessionKey(status);
    const prevKey = useRef<string | null>(null);
    useEffect(() => {
        const prev = prevKey.current;
        prevKey.current = key;
        const leftAuthedSession = prev != null && prev !== key && (prev === "auth" || prev.startsWith("user:"));
        if (leftAuthedSession) queryClient.clear();
    }, [key, queryClient]);
    return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delay={300}>
                <LocaleProvider>
                    <AuthProvider>
                        <AuthGatedLocaleSync />
                        <AuthGatedQueryReset />
                        <EventStreamProvider>
                            <DownloadStateProvider>
                                <UpdateProvider>
                                    <ActivityBarProvider>{children}</ActivityBarProvider>
                                </UpdateProvider>
                            </DownloadStateProvider>
                        </EventStreamProvider>
                    </AuthProvider>
                </LocaleProvider>
            </TooltipProvider>
        </QueryClientProvider>
    );
}
