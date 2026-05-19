import { useCallback, useEffect, useRef, useState } from "react";
import type { InboxEvent } from "@/features/events";
import { useEventStream, useRefreshOnReconnect } from "@/features/events";
import { type DownloadJob, type DownloadStatus, type DownloadTask, listDownloads } from "./api";
import { DOWNLOADS_PAGE_SIZE, PAGE_REFETCH_DEBOUNCE_MS } from "./constants";
import { patchJobTask } from "./task-patch";
import type { TaskCancelledData, TaskCompletedData, TaskFailedData, TaskProgressData, TaskStartedData } from "./types";

type UseDownloadsPageParams = {
    // Empty/undefined = no status filter.
    status?: DownloadStatus[];
    page: number;
    perPage?: number;
};

export type UseDownloadsPageResult = {
    items: DownloadJob[];
    total: number;
    isLoading: boolean;
    isFetching: boolean;
    refetch: () => Promise<void>;
};

const TASK_EVENT_STATUS: Record<string, DownloadStatus> = {
    "task.completed": "completed",
    "task.failed": "failed",
    "task.cancelled": "cancelled",
};

// Drives the Downloads management page off the server's paginated endpoint.
// Filter/page changes refetch; SSE job.* events trigger a debounced refetch;
// SSE task.* events patch items in place. State is local to each instance
// (not shared via context), unlike useTrackedDownloads.
export function useDownloadsPage(params: UseDownloadsPageParams): UseDownloadsPageResult {
    const { status, page: requestedPage, perPage = DOWNLOADS_PAGE_SIZE } = params;
    const { subscribe } = useEventStream();

    const [items, setItems] = useState<DownloadJob[]>([]);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isFetching, setIsFetching] = useState(false);

    // Stringify into a stable dep — a fresh array literal on every render
    // would re-fire the refetch effect on every state update.
    const statusKey = status?.length ? [...status].sort().join(",") : "";

    const fetchEpoch = useRef(0);
    const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const refetch = useCallback(async () => {
        const epoch = ++fetchEpoch.current;
        setIsFetching(true);
        const { data } = await listDownloads({
            status: statusKey ? (statusKey.split(",") as DownloadStatus[]) : undefined,
            page: requestedPage,
            perPage,
        });
        // Stale response (filter/page changed mid-flight).
        if (epoch !== fetchEpoch.current) return;
        if (data) {
            setItems(data.jobs);
            setTotal(data.total);
        }
        setIsFetching(false);
        setIsLoading(false);
    }, [statusKey, requestedPage, perPage]);

    useEffect(() => {
        void refetch();
    }, [refetch]);

    // Reconnect / resync closes the gap if the backend ring buffer evicted
    // our last_event_id and no replayed job.* events reach us.
    useRefreshOnReconnect(refetch);

    const patchItemTask = useCallback((jobId: string, taskId: string, patcher: (t: DownloadTask) => DownloadTask) => {
        setItems((prev) => {
            let changed = false;
            const next = prev.map((j) => {
                if (j.id !== jobId) return j;
                const patched = patchJobTask(j, taskId, patcher);
                if (patched !== j) changed = true;
                return patched;
            });
            return changed ? next : prev;
        });
    }, []);

    useEffect(() => {
        const off = subscribe("download", (ev: InboxEvent) => {
            if (ev.type.startsWith("job.")) {
                // Coalesce bursts of lifecycle events into a single refetch.
                if (refetchTimer.current) clearTimeout(refetchTimer.current);
                refetchTimer.current = setTimeout(() => {
                    refetchTimer.current = null;
                    void refetch();
                }, PAGE_REFETCH_DEBOUNCE_MS);
                return;
            }
            if (ev.type === "task.progress") {
                const d = ev.data as TaskProgressData;
                patchItemTask(d.job_id, d.task_id, (t) => {
                    const nextSize = d.total > 0 ? d.total : t.size_bytes;
                    if (t.downloaded_bytes === d.downloaded && t.size_bytes === nextSize) return t;
                    return { ...t, downloaded_bytes: d.downloaded, size_bytes: nextSize };
                });
                return;
            }
            if (ev.type === "task.started") {
                const d = ev.data as TaskStartedData;
                patchItemTask(d.job_id, d.task_id, (t) => ({
                    ...t,
                    status: "running" as DownloadStatus,
                }));
                return;
            }
            if (ev.type === "task.completed" || ev.type === "task.failed" || ev.type === "task.cancelled") {
                const d = ev.data as TaskCompletedData | TaskFailedData | TaskCancelledData;
                const newStatus = TASK_EVENT_STATUS[ev.type];
                const failureError = ev.type === "task.failed" ? (d as TaskFailedData).error : undefined;
                patchItemTask(d.job_id, d.task_id, (t) => ({
                    ...t,
                    status: newStatus,
                    error: failureError ?? t.error ?? null,
                    downloaded_bytes: newStatus === "completed" && t.size_bytes > 0 ? t.size_bytes : t.downloaded_bytes,
                }));
                return;
            }
        });
        return () => {
            off();
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
        };
    }, [subscribe, refetch, patchItemTask]);

    return { items, total, isLoading, isFetching, refetch };
}
