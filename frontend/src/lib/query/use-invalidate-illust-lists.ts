import { type Query, type QueryMeta, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

// Query `meta` for cached entries that must not be swept by useInvalidateIllustLists:
// non-list data (config, pagination frontiers) and lists that must never reshuffle on
// their own (the recommended feed).
export const SKIP_LIST_INVALIDATION: QueryMeta = { skipListInvalidation: true };

const isIllustList = (query: Query) => query.meta?.skipListInvalidation !== true;

// Returns a callback that marks cached illust-list queries stale so the next
// visit re-seeds them from the server. Call it after a mutation that changes
// per-account/per-illust state embedded in those lists (bookmark, follow, mute)
// — the AGENTS.md "Cache lifecycle" convention. This is the single home for the
// invalidation strategy, so call sites express intent and WP-4 list pages reuse
// it without copying the options.
//
// refetchType "none" only marks queries stale (refetch deferred to the next
// mount or return to a kept-alive page, where the client's refetchOnMount picks up
// the invalidation) rather than immediately re-pulling every active list on each
// toggle. The acting component is covered by its optimistic local state; OTHER
// cached copies of the same illust (e.g. a grid card behind the viewer) are kept in
// sync by a write-through patch — see usePatchCachedIllust — so this only needs to
// schedule the eventual server reconciliation.
// Every cached query counts as an illust list unless it opts out with
// SKIP_LIST_INVALIDATION.
export function useInvalidateIllustLists() {
    const queryClient = useQueryClient();
    return useCallback(() => {
        queryClient.invalidateQueries({ predicate: isIllustList, refetchType: "none" });
    }, [queryClient]);
}
