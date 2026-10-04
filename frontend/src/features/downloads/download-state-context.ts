import { createContext } from "react";
import type { DownloadApiError, DownloadJob, DownloadStatus } from "./api";
import type { DownloadStateStore } from "./download-store";

export type { TrackedJob } from "./download-store";

// Created once per provider and never replaced, so consumers that only act
// (or subscribe to one illust through the store) don't re-render on SSE ticks.
export interface DownloadActions {
    // Map<illust_id, TrackedJob> of queued/running jobs plus jobs whose
    // terminal state is younger than TRACKED_TTL_MS, and the global counts.
    store: DownloadStateStore;
    submit: (illustId: number) => Promise<DownloadJob | null>;
    cancel: (jobId: string) => Promise<void>;
    remove: (jobId: string) => Promise<void>;
    clear: (statuses: DownloadStatus[]) => Promise<number>;
}

export const DownloadActionsContext = createContext<DownloadActions | null>(null);

// Per-key error stash. Cancel/remove use the job_id as key, submit uses
// `submit:${illustId}`.
export type DownloadErrors = Record<string, DownloadApiError>;

export const DownloadErrorsContext = createContext<DownloadErrors | null>(null);
