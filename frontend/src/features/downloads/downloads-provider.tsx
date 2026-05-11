import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth";
import type { InboxEvent } from "@/features/events";
import { useEventStream } from "@/features/events";
import {
    ACTIVE_STATUSES,
    cancelDownload,
    type DownloadApiError,
    type DownloadJob,
    type DownloadStatus,
    listDownloads,
    removeDownload,
    submitDownload,
} from "./api";
import { DownloadsContext, type DownloadsContextValue } from "./downloads-context";
import type {
    JobEventData,
    TaskCancelledData,
    TaskCompletedData,
    TaskFailedData,
    TaskProgressData,
    TaskStartedData,
} from "./types";

function sortJobs(jobs: DownloadJob[]): DownloadJob[] {
    // Stable across progress ticks (which never reorder jobs).
    return [...jobs].sort((a, b) => {
        const ad = Date.parse(a.created_at) || 0;
        const bd = Date.parse(b.created_at) || 0;
        if (bd !== ad) return bd - ad;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
}

// Job status is owned by the backend: every server-side aggregation change is
// followed by a job.* event. We update task state on task.* events but never
// recompute job.status — keeps client/backend rules from drifting.
const JOB_EVENT_STATUS: Record<string, DownloadStatus> = {
    "job.started": "running",
    "job.completed": "completed",
    "job.failed": "failed",
    "job.cancelled": "cancelled",
};

const TASK_EVENT_STATUS: Record<string, DownloadStatus> = {
    "task.completed": "completed",
    "task.failed": "failed",
    "task.cancelled": "cancelled",
};

export function DownloadsProvider({ children }: { children: ReactNode }) {
    const { status: authStatus } = useAuth();
    const { subscribe, connected } = useEventStream();
    const authResolved = authStatus !== null;
    const authenticated = !!authStatus?.authenticated;
    const [jobMap, setJobMap] = useState<Map<string, DownloadJob>>(new Map());
    const [lastError, setLastError] = useState<Record<string, DownloadApiError>>({});
    const [initialLoaded, setInitialLoaded] = useState(false);
    const refreshingRef = useRef(false);
    const jobMapRef = useRef(jobMap);
    // Render-body assignment so the SSE handler can read the current map
    // synchronously without an extra effect commit on every progress tick.
    jobMapRef.current = jobMap;

    const mutateJob = useCallback((jobId: string, patch: (job: DownloadJob) => DownloadJob) => {
        setJobMap((prev) => {
            const cur = prev.get(jobId);
            if (!cur) return prev;
            const next = patch(cur);
            if (next === cur) return prev;
            const out = new Map(prev);
            out.set(jobId, next);
            return out;
        });
    }, []);

    const refresh = useCallback(async () => {
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        try {
            const { data } = await listDownloads();
            if (!data) return;
            const next = new Map<string, DownloadJob>();
            for (const j of data.jobs) next.set(j.id, j);
            setJobMap(next);
        } finally {
            refreshingRef.current = false;
            setInitialLoaded(true);
        }
    }, []);

    // Auth-session lifecycle: refresh on auth-in, reset on auth-out, wait while resolving.
    // Keyed on the boolean so an AuthStatus identity churn (e.g. a periodic status
    // refresh) doesn't re-trigger this.
    useEffect(() => {
        if (!authResolved) return;
        if (authenticated) {
            void refresh();
        } else {
            setJobMap(new Map());
            setLastError({});
            setInitialLoaded(true);
        }
    }, [authResolved, authenticated, refresh]);

    // Catch the gap between the auth-in refresh snapshot and the moment the SSE
    // stream actually starts delivering events. refreshingRef coalesces, so this
    // collapses with the auth-lifecycle refresh on first connect.
    useEffect(() => {
        if (connected) void refresh();
    }, [connected, refresh]);

    useEffect(() => {
        const off = subscribe("download", (ev: InboxEvent) => {
            switch (ev.type) {
                case "job.queued": {
                    // Local submits seed the map synchronously from submitDownload()'s
                    // response. Anything unknown here originated from another tab/client
                    // — refresh to pick it up (refreshingRef coalesces bursts).
                    const d = ev.data as JobEventData;
                    if (!jobMapRef.current.has(d.job_id)) void refresh();
                    return;
                }
                case "job.started":
                case "job.completed":
                case "job.failed":
                case "job.cancelled": {
                    const d = ev.data as JobEventData;
                    const status = JOB_EVENT_STATUS[ev.type];
                    mutateJob(d.job_id, (cur) => (cur.status === status ? cur : { ...cur, status, updated_at: ev.ts }));
                    return;
                }
                case "job.deleted": {
                    const d = ev.data as JobEventData;
                    setJobMap((prev) => {
                        if (!prev.has(d.job_id)) return prev;
                        const out = new Map(prev);
                        out.delete(d.job_id);
                        return out;
                    });
                    return;
                }
                case "task.started": {
                    const d = ev.data as TaskStartedData;
                    mutateJob(d.job_id, (cur) => {
                        const tasks = cur.tasks.map((t) =>
                            t.id === d.task_id ? { ...t, status: "running" as const } : t,
                        );
                        return { ...cur, tasks };
                    });
                    return;
                }
                case "task.progress": {
                    // Hot path (~250ms per task). Short-circuit when bytes haven't moved.
                    const d = ev.data as TaskProgressData;
                    mutateJob(d.job_id, (cur) => {
                        let changed = false;
                        const tasks = cur.tasks.map((t) => {
                            if (t.id !== d.task_id) return t;
                            const nextSize = d.total > 0 ? d.total : t.size_bytes;
                            if (t.downloaded_bytes === d.downloaded && t.size_bytes === nextSize) return t;
                            changed = true;
                            return { ...t, downloaded_bytes: d.downloaded, size_bytes: nextSize };
                        });
                        return changed ? { ...cur, tasks } : cur;
                    });
                    return;
                }
                case "task.completed":
                case "task.failed":
                case "task.cancelled": {
                    const d = ev.data as TaskCompletedData | TaskFailedData | TaskCancelledData;
                    const status = TASK_EVENT_STATUS[ev.type];
                    const failureError = ev.type === "task.failed" ? (d as TaskFailedData).error : undefined;
                    mutateJob(d.job_id, (cur) => {
                        const tasks = cur.tasks.map((t) =>
                            t.id !== d.task_id
                                ? t
                                : {
                                      ...t,
                                      status,
                                      error: failureError ?? t.error ?? null,
                                      downloaded_bytes:
                                          status === "completed" && t.size_bytes > 0
                                              ? t.size_bytes
                                              : t.downloaded_bytes,
                                  },
                        );
                        return { ...cur, tasks };
                    });
                    return;
                }
            }
        });
        return off;
    }, [subscribe, mutateJob, refresh]);

    useEffect(() => {
        const off = subscribe("system", (ev: InboxEvent) => {
            if (ev.type === "resync") void refresh();
        });
        return off;
    }, [subscribe, refresh]);

    const setError = useCallback((key: string, err: DownloadApiError) => {
        setLastError((prev) => ({ ...prev, [key]: err }));
    }, []);

    const clearError = useCallback((key: string) => {
        setLastError((prev) => {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, []);

    const submit = useCallback(
        async (illustId: number) => {
            const key = `submit:${illustId}`;
            clearError(key);
            const { data, error } = await submitDownload(illustId);
            if (error) {
                setError(key, error);
                return null;
            }
            if (data) {
                setJobMap((prev) => {
                    const out = new Map(prev);
                    out.set(data.id, data);
                    return out;
                });
            }
            return data;
        },
        [clearError, setError],
    );

    // cancel/remove are fire-and-forget; SSE drives state. We only stash HTTP
    // errors so the row can surface them inline.
    const cancel = useCallback(
        async (jobId: string) => {
            clearError(jobId);
            const { error } = await cancelDownload(jobId);
            if (error) setError(jobId, error);
        },
        [clearError, setError],
    );

    const remove = useCallback(
        async (jobId: string, purgeFiles: boolean) => {
            clearError(jobId);
            const { error } = await removeDownload(jobId, purgeFiles);
            if (error) setError(jobId, error);
        },
        [clearError, setError],
    );

    const { jobs, activeCount, doneCount } = useMemo(() => {
        const list = sortJobs(Array.from(jobMap.values()));
        let active = 0;
        let done = 0;
        for (const j of list) {
            if (ACTIVE_STATUSES.includes(j.status)) active++;
            else if (j.status === "completed") done++;
        }
        return { jobs: list, activeCount: active, doneCount: done };
    }, [jobMap]);

    const value = useMemo<DownloadsContextValue>(
        () => ({
            jobs,
            activeCount,
            doneCount,
            lastError,
            initialLoaded,
            submit,
            cancel,
            remove,
            refresh,
        }),
        [jobs, activeCount, doneCount, lastError, initialLoaded, submit, cancel, remove, refresh],
    );

    return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}
