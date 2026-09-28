import { hashKey, type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { advanceFrontier, type Frontier, INITIAL_FRONTIER, type PageObservation } from "@/lib/pagination";

// Holds one list's Frontier (see lib/pagination.ts) in the Query cache under
// ["page-frontier", ...identity]. Living there instead of in component state means the
// learned pages survive a remount (back from a detail view), expire with the rest of the
// list cache (gcTime), and are wiped by the account-change `queryClient.clear()`.
// `identity` is the list's query params minus the pagination field.
export function usePageFrontier(identity: QueryKey) {
    const queryClient = useQueryClient();
    const queryKey = ["page-frontier", ...identity];
    const keyHash = hashKey(queryKey);
    const { data } = useQuery<Frontier>({
        queryKey,
        // Never fetched for real; a blanket invalidation just re-reads what is cached.
        queryFn: () => queryClient.getQueryData<Frontier>(queryKey) ?? INITIAL_FRONTIER,
        initialData: INITIAL_FRONTIER,
        staleTime: Number.POSITIVE_INFINITY,
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyHash stands in for queryKey, which is rebuilt every render.
    const record = useCallback(
        (obs: PageObservation) =>
            queryClient.setQueryData<Frontier>(queryKey, (prev) => advanceFrontier(prev ?? INITIAL_FRONTIER, obs)),
        [queryClient, keyHash],
    );
    return { frontier: data, record };
}

// Persists a fetched page's observation. Pass undefined while the page is pending or showing
// placeholder data — a previous page's result must not be recorded under this page.
export function useRecordPage(record: (obs: PageObservation) => void, observed: PageObservation | undefined) {
    const page = observed?.page;
    const outcome = observed?.outcome;
    const nextCursor = observed?.nextCursor;
    useEffect(() => {
        if (page != null && outcome != null) record({ page, outcome, nextCursor });
    }, [record, page, outcome, nextCursor]);
}
