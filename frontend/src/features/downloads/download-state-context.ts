import { createContext } from "react";
import type { DownloadApiError, DownloadJob, DownloadStatus } from "./api";

// TrackedJob is a DownloadJob plus the timestamp at which it entered a
// terminal state, used by the sweep timer to evict expired entries from
// the tracked map. Active jobs leave terminatedAt undefined.
export type TrackedJob = DownloadJob & { terminatedAt?: number };

export interface DownloadStateContextValue {
    // Map<illust_id, TrackedJob>. Holds queued/running jobs plus jobs
    // whose terminal state is younger than TRACKED_TTL_MS.
    tracked: Map<number, TrackedJob>;

    // Global aggregates pushed by the backend on every job lifecycle
    // event. activeCount = queued + running; doneCount = completed only.
    activeCount: number;
    doneCount: number;

    // Per-key error stash. Cancel/remove use the job_id as key, submit
    // uses `submit:${illustId}`.
    lastError: Record<string, DownloadApiError>;

    // True once the initial fetch settled (success OR auth-out reset).
    // Drives the "loading" placeholders.
    initialLoaded: boolean;

    submit: (illustId: number) => Promise<DownloadJob | null>;
    cancel: (jobId: string) => Promise<void>;
    remove: (jobId: string) => Promise<void>;
    clear: (statuses: DownloadStatus[]) => Promise<number>;
}

export const DownloadStateContext = createContext<DownloadStateContextValue | null>(null);
