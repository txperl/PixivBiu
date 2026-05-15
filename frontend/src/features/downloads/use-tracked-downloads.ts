import { useContext } from "react";
import { DownloadStateContext, type TrackedJob } from "./download-state-context";

export type { TrackedJob };

// Map<illust_id, TrackedJob> of every queued/running job plus jobs that
// entered a terminal state within TRACKED_TTL_MS. Consumed by card
// download buttons (per-illust status) and the downloads sheet (small
// recent list).
export function useTrackedDownloads() {
    const ctx = useContext(DownloadStateContext);
    if (!ctx) throw new Error("useTrackedDownloads must be used inside <DownloadStateProvider>");
    return { tracked: ctx.tracked, initialLoaded: ctx.initialLoaded };
}
