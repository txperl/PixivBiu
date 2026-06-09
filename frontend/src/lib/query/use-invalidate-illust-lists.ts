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
// mount) rather than immediately re-pulling every active list on each toggle.
// The acting component is covered by its optimistic local state; OTHER cached
// copies of the same illust (e.g. a grid card behind the viewer) are kept in sync
// by a write-through patch — see usePatchCachedIllust — so this only needs to
// schedule the eventual server reconciliation.
// Every cached query is an illust list today, so the invalidation is unfiltered;
// narrow it with a queryKey/predicate here if non-list queries ever join the cache.
export function useInvalidateIllustLists() {
    const queryClient = useQueryClient();
    return useCallback(() => {
        queryClient.invalidateQueries({ refetchType: "none" });
    }, [queryClient]);
}
