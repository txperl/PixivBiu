import { useContext } from "react";
import { DownloadStateContext } from "./download-state-context";

// Global queued+running / completed counts. Updates on every job.*
// SSE event (counts are inlined into the payload by the backend).
export function useDownloadCounts() {
    const ctx = useContext(DownloadStateContext);
    if (!ctx) throw new Error("useDownloadCounts must be used inside <DownloadStateProvider>");
    return { activeCount: ctx.activeCount, doneCount: ctx.doneCount };
}
