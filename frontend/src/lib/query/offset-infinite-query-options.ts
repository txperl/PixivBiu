import { type InfiniteData, infiniteQueryOptions, type QueryKey } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";

// Shared builder for offset-paged infinite lists (the home feeds). It centralizes
// the verbose 5-generic `infiniteQueryOptions` instantiation so callers get a typed
// `number` pageParam and a typed `ApiError` (which `<SearchError>` consumes), instead
// of the `unknown` pageParam you'd get from pinning only <T, ApiError>.
//
// Every offset-paged response exposes `next_offset` (null = no further page). offset=0
// is the first page and is already sent explicitly today (page-1 loads pass offset:0),
// so `initialPageParam: 0` reproduces current behavior — 0 is not treated as "omitted".
//
// Cursor lists (`/users/{id}/bookmarks`, paginated by `max_bookmark_id`) deliberately
// do NOT use this — they stay on a per-page useQuery + numbered pager (see the user page).
export function offsetInfiniteQueryOptions<T extends { next_offset?: number | null }>(opts: {
    queryKey: QueryKey;
    fetchPage: (offset: number) => Promise<T>; // caller resolves with `.then(unwrap)`
}) {
    return infiniteQueryOptions<T, ApiError, InfiniteData<T, number>, QueryKey, number>({
        queryKey: opts.queryKey,
        queryFn: ({ pageParam }) => opts.fetchPage(pageParam),
        initialPageParam: 0,
        getNextPageParam: (last) => last.next_offset ?? undefined, // undefined ⇒ hasNextPage:false
    });
}
