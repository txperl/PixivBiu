import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth";
import type { InboxEvent } from "@/features/events";
import { useEventStream, useRefreshOnReconnect } from "@/features/events";
import {
    cancelDownload,
    clearDownloads,
    type DownloadApiError,
    type DownloadJob,
    type DownloadStatus,
    type DownloadTask,
    getDownload,
    isTerminalStatus,
    listDownloads,
    removeDownload,
    submitDownload,
} from "./api";
import { TRACKED_INITIAL_FETCH_LIMIT, TRACKED_SWEEP_INTERVAL_MS, TRACKED_TTL_MS } from "./constants";
import { DownloadStateContext, type DownloadStateContextValue, type TrackedJob } from "./download-state-context";
import { patchJobTask } from "./task-patch";
import type {
    JobEventData,
    TaskCancelledData,
    TaskCompletedData,
    TaskFailedData,
    TaskProgressData,
    TaskStartedData,
} from "./types";

const ACTIVE_STATUSES_CSV: DownloadStatus[] = ["queued", "running"];
const TERMINAL_STATUSES_CSV: DownloadStatus[] = ["completed", "failed", "cancelled"];

// Job status is owned by the backend: every aggregation change is followed
// by a job.* event. We patch task state on task.* events but never recompute
// job.status — keeps client/server rules in lockstep.
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

export function DownloadStateProvider({ children }: { children: ReactNode }) {
    const { status: authStatus } = useAuth();
    const { subscribe } = useEventStream();
    const authResolved = authStatus !== null;
    const authenticated = !!authStatus?.authenticated;

    const [tracked, setTracked] = useState<Map<number, TrackedJob>>(new Map());
    const [activeCount, setActiveCount] = useState(0);
    const [doneCount, setDoneCount] = useState(0);
    const [lastError, setLastError] = useState<Record<string, DownloadApiError>>({});
    const [initialLoaded, setInitialLoaded] = useState(false);

    const trackedRef = useRef(tracked);
    trackedRef.current = tracked;

    const refreshingRef = useRef(false);

    // The job_id check guards against late events landing on a slot that a
    // newer job has already claimed (same illust, fresh submission).
    const mutateJob = useCallback((illustId: number, eventJobId: string, patch: (j: TrackedJob) => TrackedJob) => {
        setTracked((prev) => {
            const cur = prev.get(illustId);
            if (!cur || cur.id !== eventJobId) return prev;
            const next = patch(cur);
            if (next === cur) return prev;
            const out = new Map(prev);
            out.set(illustId, next);
            return out;
        });
    }, []);

    // Auto-stamp terminatedAt when the inserted job is already terminal,
    // so a cross-tab job that finished before our GET fallback returned
    // still gets swept on TTL expiry instead of sticking forever.
    const upsertJob = useCallback((job: DownloadJob) => {
        setTracked((prev) => {
            const out = new Map(prev);
            const entry: TrackedJob = isTerminalStatus(job.status)
                ? { ...job, terminatedAt: Date.parse(job.updated_at) || Date.now() }
                : job;
            out.set(job.illust_id, entry);
            return out;
        });
    }, []);

    // Task events carry job_id but not illust_id, so we scan the map. With
    // typical N (active + recent-terminal jobs) this is cheap enough; if N
    // grows, add a job_id → illust_id index.
    const patchTaskByJobId = useCallback(
        (jobId: string, taskId: string, patcher: (t: DownloadTask) => DownloadTask) => {
            setTracked((prev) => {
                for (const [illustId, j] of prev) {
                    if (j.id !== jobId) continue;
                    const next = patchJobTask(j, taskId, patcher);
                    if (next === j) return prev;
                    const out = new Map(prev);
                    out.set(illustId, next);
                    return out;
                }
                return prev;
            });
        },
        [],
    );

    const refresh = useCallback(async () => {
        if (refreshingRef.current) return;
        refreshingRef.current = true;
        try {
            const since = new Date(Date.now() - TRACKED_TTL_MS);
            const [activeResp, recentResp] = await Promise.all([
                listDownloads({ status: ACTIVE_STATUSES_CSV, perPage: TRACKED_INITIAL_FETCH_LIMIT }),
                listDownloads({
                    status: TERMINAL_STATUSES_CSV,
                    updatedSince: since,
                    perPage: TRACKED_INITIAL_FETCH_LIMIT,
                }),
            ]);
            const counts = activeResp.data ?? recentResp.data;
            if (counts) {
                setActiveCount(counts.active_count);
                setDoneCount(counts.done_count);
            }

            const next = new Map<number, TrackedJob>();
            const insert = (j: DownloadJob, isTerm: boolean) => {
                // Same illust may appear in both responses if it transitioned
                // between the two requests — keep the newer updated_at.
                const existing = next.get(j.illust_id);
                if (existing) {
                    const a = Date.parse(existing.updated_at) || 0;
                    const b = Date.parse(j.updated_at) || 0;
                    if (b < a) return;
                }
                const entry: TrackedJob = isTerm ? { ...j, terminatedAt: Date.parse(j.updated_at) || Date.now() } : j;
                next.set(j.illust_id, entry);
            };
            for (const j of activeResp.data?.jobs ?? []) insert(j, false);
            for (const j of recentResp.data?.jobs ?? []) insert(j, true);
            setTracked(next);
        } finally {
            refreshingRef.current = false;
            setInitialLoaded(true);
        }
    }, []);

    useEffect(() => {
        if (!authResolved) return;
        if (authenticated) {
            void refresh();
        } else {
            setTracked(new Map());
            setActiveCount(0);
            setDoneCount(0);
            setLastError({});
            setInitialLoaded(true);
        }
    }, [authResolved, authenticated, refresh]);

    // refreshingRef coalesces a reconnect-driven refresh with an in-flight
    // auth-in refresh if they happen to race.
    useRefreshOnReconnect(refresh);

    useEffect(() => {
        const off = subscribe("download", (ev: InboxEvent) => {
            // job.* events carry the latest counts; task.* events don't, to
            // avoid emitting counts on every progress tick.
            if (ev.type.startsWith("job.")) {
                const d = ev.data as JobEventData;
                setActiveCount(d.active_count);
                setDoneCount(d.done_count);
            }

            switch (ev.type) {
                case "job.queued": {
                    const d = ev.data as JobEventData;
                    const cur = trackedRef.current.get(d.illust_id);
                    if (cur?.id === d.job_id) return;
                    // Cross-tab submission; fetch the full job to populate the map.
                    void getDownload(d.job_id).then(({ data }) => {
                        if (data) upsertJob(data);
                    });
                    return;
                }
                case "job.started":
                case "job.completed":
                case "job.failed":
                case "job.cancelled": {
                    const d = ev.data as JobEventData;
                    const newStatus = JOB_EVENT_STATUS[ev.type];
                    const terminal = isTerminalStatus(newStatus);
                    mutateJob(d.illust_id, d.job_id, (cur) => {
                        if (cur.status === newStatus && !!cur.terminatedAt === terminal) return cur;
                        const next: TrackedJob = { ...cur, status: newStatus, updated_at: ev.ts };
                        if (terminal) next.terminatedAt = Date.parse(ev.ts) || Date.now();
                        return next;
                    });
                    return;
                }
                case "job.deleted": {
                    const d = ev.data as JobEventData;
                    setTracked((prev) => {
                        const cur = prev.get(d.illust_id);
                        if (!cur || cur.id !== d.job_id) return prev;
                        const out = new Map(prev);
                        out.delete(d.illust_id);
                        return out;
                    });
                    return;
                }
                case "task.started": {
                    const d = ev.data as TaskStartedData;
                    patchTaskByJobId(d.job_id, d.task_id, (t) => ({
                        ...t,
                        status: "running" as DownloadStatus,
                    }));
                    return;
                }
                case "task.progress": {
                    const d = ev.data as TaskProgressData;
                    patchTaskByJobId(d.job_id, d.task_id, (t) => {
                        const nextSize = d.total > 0 ? d.total : t.size_bytes;
                        if (t.downloaded_bytes === d.downloaded && t.size_bytes === nextSize) return t;
                        return { ...t, downloaded_bytes: d.downloaded, size_bytes: nextSize };
                    });
                    return;
                }
                case "task.completed":
                case "task.failed":
                case "task.cancelled": {
                    const d = ev.data as TaskCompletedData | TaskFailedData | TaskCancelledData;
                    const newStatus = TASK_EVENT_STATUS[ev.type];
                    const failureError = ev.type === "task.failed" ? (d as TaskFailedData).error : undefined;
                    patchTaskByJobId(d.job_id, d.task_id, (t) => ({
                        ...t,
                        status: newStatus,
                        error: failureError ?? t.error ?? null,
                        downloaded_bytes:
                            newStatus === "completed" && t.size_bytes > 0 ? t.size_bytes : t.downloaded_bytes,
                    }));
                    return;
                }
            }
        });
        return off;
    }, [subscribe, mutateJob, upsertJob, patchTaskByJobId]);

    useEffect(() => {
        const id = setInterval(() => {
            const cutoff = Date.now() - TRACKED_TTL_MS;
            setTracked((prev) => {
                let out: Map<number, TrackedJob> | null = null;
                for (const [illustId, j] of prev) {
                    if (j.terminatedAt === undefined || j.terminatedAt >= cutoff) continue;
                    if (!out) out = new Map(prev);
                    out.delete(illustId);
                }
                return out ?? prev;
            });
        }, TRACKED_SWEEP_INTERVAL_MS);
        return () => clearInterval(id);
    }, []);

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
            if (data) upsertJob(data);
            return data;
        },
        [clearError, setError, upsertJob],
    );

    // cancel/remove are fire-and-forget; SSE drives state. We only stash
    // HTTP errors so consumers can surface them inline.
    const cancel = useCallback(
        async (jobId: string) => {
            clearError(jobId);
            const { error } = await cancelDownload(jobId);
            if (error) setError(jobId, error);
        },
        [clearError, setError],
    );
    const remove = useCallback(
        async (jobId: string) => {
            clearError(jobId);
            const { error } = await removeDownload(jobId);
            if (error) setError(jobId, error);
        },
        [clearError, setError],
    );
    const clear = useCallback(
        async (statuses: DownloadStatus[]): Promise<number> => {
            const key = "clear";
            clearError(key);
            const { data, error } = await clearDownloads(statuses);
            if (error) {
                setError(key, error);
                return 0;
            }
            return data?.removed ?? 0;
        },
        [clearError, setError],
    );

    const value = useMemo<DownloadStateContextValue>(
        () => ({ tracked, activeCount, doneCount, lastError, initialLoaded, submit, cancel, remove, clear }),
        [tracked, activeCount, doneCount, lastError, initialLoaded, submit, cancel, remove, clear],
    );

    return <DownloadStateContext.Provider value={value}>{children}</DownloadStateContext.Provider>;
}
