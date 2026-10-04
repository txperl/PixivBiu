import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ACTIVE_STATUSES, type DownloadJob } from "./api";
import { useDownloadActions } from "./use-download-mutations";

export type IllustDownloadStatus = {
    job: DownloadJob | null;
    active: boolean;
    percent: number | null;
};

// The illust's most recent tracked job. Subscribes to that illust only, so a
// progress tick re-renders just the controls showing it.
export function useTrackedJob(illustId: number) {
    const { store } = useDownloadActions();
    const subscribe = useCallback(
        (listener: () => void) => store.subscribeIllust(illustId, listener),
        [store, illustId],
    );
    return useSyncExternalStore(subscribe, () => store.get(illustId));
}

export function deriveIllustDownloadStatus(job: DownloadJob | undefined): IllustDownloadStatus {
    if (!job) return { job: null, active: false, percent: null };
    const active = ACTIVE_STATUSES.includes(job.status);
    if (!active) return { job, active: false, percent: null };
    if (job.tasks.length === 0) return { job, active: true, percent: null };
    let downloaded = 0;
    let total = 0;
    for (const t of job.tasks) {
        // size_bytes <= 0 means Content-Length unknown → fall back to indeterminate.
        if (t.size_bytes <= 0) return { job, active: true, percent: null };
        downloaded += t.downloaded_bytes;
        total += t.size_bytes;
    }
    if (total <= 0) return { job, active: true, percent: null };
    return { job, active: true, percent: Math.min(1, downloaded / total) };
}

export function useIllustDownloadStatus(illustId: number): IllustDownloadStatus {
    const job = useTrackedJob(illustId);
    return useMemo(() => deriveIllustDownloadStatus(job), [job]);
}
