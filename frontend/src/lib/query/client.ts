import { QueryClient } from "@tanstack/react-query";

// How long unobserved query data stays cached. Kept-alive pages that are hidden
// unsubscribe their observers, so this must outlive their idle TTL (see
// app/keep-alive) or a returning page would find its data collected.
export const QUERY_GC_TIME = 30 * 60_000;

// App-wide singleton QueryClient, created once at module load (NOT inside a
// component) so the cache survives re-renders and there is exactly one cache for
// the whole SPA. Tuned for a read-mostly Pixiv browsing UI:
//   staleTime 60s  — lists don't change second-to-second; paging back and forth
//                    within a minute reuses cache instead of re-hitting Pixiv.
//   gcTime    30m  — see QUERY_GC_TIME.
//   refetchOnMount only when invalidated — returning to a page (remount or an
//                    <Activity> reveal, which re-subscribes) shows it exactly as
//                    left; only lists a mutation marked stale (bookmark/follow/
//                    mute) reconcile in the background. Time-based staleness still
//                    governs param changes and enabling a query. Opt back in per
//                    factory where opening must always refresh (illust detail).
//   refetchOnWindowFocus false — browsing app; refocusing must not reshuffle a
//                    ranking the user is mid-scroll through.
//   retry     1    — moderate; a transient proxy/upstream hiccup gets one retry,
//                    a real error surfaces quickly (the old code had 0 retries).
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 60_000,
            gcTime: QUERY_GC_TIME,
            refetchOnMount: (query) => query.state.isInvalidated,
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});
