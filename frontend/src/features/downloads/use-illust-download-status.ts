import { useMemo } from "react";
import { ACTIVE_STATUSES, type DownloadJob } from "./api";
import { useTrackedDownloads } from "./use-tracked-downloads";

export type IllustDownloadStatus = {
    job: DownloadJob | null;
    active: boolean;
    percent: number | null;
};

export function useIllustDownloadStatus(illustId: number): IllustDownloadStatus {
    const { tracked } = useTrackedDownloads();
    return useMemo(() => {
        // Map is keyed by illust_id and holds the most recent job per illust.
        const job = tracked.get(illustId) ?? null;
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
    }, [tracked, illustId]);
}
