import { useMemo } from "react";
import { ACTIVE_STATUSES, type DownloadJob } from "./api";
import { useDownloads } from "./use-downloads";

export type IllustDownloadStatus = {
    job: DownloadJob | null;
    active: boolean;
    percent: number | null;
};

export function useIllustDownloadStatus(illustId: number): IllustDownloadStatus {
    const { jobs } = useDownloads();
    return useMemo(() => {
        // jobs are sorted desc by created_at in the provider, so find() picks the most recent.
        const job = jobs.find((j) => j.illust_id === illustId) ?? null;
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
    }, [jobs, illustId]);
}
