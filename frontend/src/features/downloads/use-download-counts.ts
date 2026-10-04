import { useSyncExternalStore } from "react";
import { useDownloadActions } from "./use-download-mutations";

// Global queued+running / completed counts. Updates on every job.*
// SSE event (counts are inlined into the payload by the backend).
export function useDownloadCounts() {
    const { store } = useDownloadActions();
    return useSyncExternalStore(store.subscribeCounts, store.getCounts);
}
