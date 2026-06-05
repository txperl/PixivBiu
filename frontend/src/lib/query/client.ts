import { QueryClient } from "@tanstack/react-query";

// App-wide singleton QueryClient, created once at module load (NOT inside a
// component) so the cache survives re-renders and there is exactly one cache for
// the whole SPA. Tuned for a read-mostly Pixiv browsing UI:
//   staleTime 60s  — lists don't change second-to-second; paging back and forth
//                    within a minute reuses cache instead of re-hitting Pixiv.
//   gcTime    5m   — unused pages stay cached long enough that returning is
//                    instant, without holding memory forever.
//   refetchOnWindowFocus false — browsing app; refocusing must not reshuffle a
//                    ranking the user is mid-scroll through.
//   retry     1    — moderate; a transient proxy/upstream hiccup gets one retry,
//                    a real error surfaces quickly (the old code had 0 retries).
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});
