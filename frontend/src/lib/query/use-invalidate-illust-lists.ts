import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

// Returns a callback that marks cached illust-list queries stale so the next
// visit re-seeds them from the server. Call it after a mutation that changes
// per-account/per-illust state embedded in those lists (bookmark, follow, mute)
// — the AGENTS.md "Cache lifecycle" convention. This is the single home for the
// invalidation strategy, so call sites express intent and WP-4 list pages reuse
// it without copying the options.
//
// refetchType "none" only marks queries stale (refetch deferred to the next
// mount) rather than immediately re-pulling every active list on each toggle —
// the in-view card is already covered by the caller's optimistic local state.
// Every cached query is an illust list today, so the invalidation is unfiltered;
// narrow it with a queryKey/predicate here if non-list queries ever join the cache.
export function useInvalidateIllustLists() {
    const queryClient = useQueryClient();
    return useCallback(() => {
        queryClient.invalidateQueries({ refetchType: "none" });
    }, [queryClient]);
}
