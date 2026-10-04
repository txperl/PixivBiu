import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth";
import { useEventStream, useRefreshOnReconnect } from "@/features/events";
import {
    cancelDownload,
    clearDownloads,
    type DownloadApiError,
    type DownloadJob,
    type DownloadStatus,
    getDownload,
    listDownloads,
    removeDownload,
    submitDownload,
} from "./api";
import { TRACKED_INITIAL_FETCH_LIMIT, TRACKED_SWEEP_INTERVAL_MS, TRACKED_TTL_MS } from "./constants";
import {
    type DownloadActions,
    DownloadActionsContext,
    type DownloadErrors,
    DownloadErrorsContext,
} from "./download-state-context";
import { applyDownloadEvent, DownloadStateStore, type TrackedJob, toTrackedJob } from "./download-store";
import { ScopedSubmissions } from "./scoped-submissions";

const ACTIVE_STATUSES_CSV: DownloadStatus[] = ["queued", "running"];
const TERMINAL_STATUSES_CSV: DownloadStatus[] = ["completed", "failed", "cancelled"];

export function DownloadStateProvider({ children }: { children: ReactNode }) {
    const { status: authStatus } = useAuth();
    const { subscribe } = useEventStream();
    const authResolved = authStatus !== null;
    const authenticated = !!authStatus?.authenticated;
    const sessionKey = !authResolved ? "loading" : authenticated ? `user:${authStatus?.user_id ?? "unknown"}` : "anon";
    const session = useMemo(() => ({ key: sessionKey, authenticated }), [sessionKey, authenticated]);
    const sessionRef = useRef<typeof session | null>(session);
    const [submissions] = useState(() => new ScopedSubmissions<Awaited<ReturnType<typeof submitDownload>>>());

    useLayoutEffect(() => {
        sessionRef.current = session;
        submissions.setScope(session);
        return () => {
            if (sessionRef.current === session) sessionRef.current = null;
            submissions.setScope(null);
        };
    }, [session, submissions]);

    const [store] = useState(() => new DownloadStateStore());
    const [lastError, setLastError] = useState<DownloadErrors>({});

    const refreshingRef = useRef<typeof session | null>(null);

    const refresh = useCallback(async () => {
        const currentSession = sessionRef.current;
        if (!currentSession?.authenticated || refreshingRef.current === currentSession) return;
        refreshingRef.current = currentSession;
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
            if (sessionRef.current !== currentSession) return;
            const counts = activeResp.data ?? recentResp.data;
            if (counts) store.setCounts(counts.active_count, counts.done_count);

            const next = new Map<number, TrackedJob>();
            const insert = (j: DownloadJob) => {
                // Same illust may appear in both responses if it transitioned
                // between the two requests — keep the newer updated_at.
                const existing = next.get(j.illust_id);
                if (existing) {
                    const a = Date.parse(existing.updated_at) || 0;
                    const b = Date.parse(j.updated_at) || 0;
                    if (b < a) return;
                }
                next.set(j.illust_id, toTrackedJob(j));
            };
            for (const j of activeResp.data?.jobs ?? []) insert(j);
            for (const j of recentResp.data?.jobs ?? []) insert(j);
            store.replaceAll(next);
        } finally {
            if (refreshingRef.current === currentSession) refreshingRef.current = null;
        }
    }, [store]);

    useEffect(() => {
        if (session.key === "loading") return;
        store.reset();
        setLastError({});
        if (session.authenticated) void refresh();
    }, [refresh, session, store]);

    // refreshingRef coalesces a reconnect-driven refresh with an in-flight
    // auth-in refresh if they happen to race.
    useRefreshOnReconnect(refresh);

    useEffect(() => {
        const off = subscribe("download", (ev) => {
            applyDownloadEvent(store, ev, (jobId) => {
                // Submitted elsewhere (another tab or client); fetch the full job.
                const currentSession = sessionRef.current;
                void getDownload(jobId).then(({ data }) => {
                    if (data && currentSession === sessionRef.current) store.upsert(data);
                });
            });
        });
        return off;
    }, [subscribe, store]);

    useEffect(() => {
        const id = setInterval(() => store.sweep(Date.now() - TRACKED_TTL_MS), TRACKED_SWEEP_INTERVAL_MS);
        return () => clearInterval(id);
    }, [store]);

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
            if (!sessionRef.current?.authenticated) return null;
            const response = await submissions.run(
                illustId,
                () => {
                    clearError(`submit:${illustId}`);
                    return submitDownload(illustId);
                },
                ({ data, error }) => {
                    if (error) setError(`submit:${illustId}`, error);
                    else if (data) store.upsert(data);
                },
            );
            return response?.error ? null : (response?.data ?? null);
        },
        [clearError, setError, store, submissions],
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

    const actions = useMemo<DownloadActions>(
        () => ({ store, submit, cancel, remove, clear }),
        [store, submit, cancel, remove, clear],
    );

    return (
        <DownloadActionsContext value={actions}>
            <DownloadErrorsContext value={lastError}>{children}</DownloadErrorsContext>
        </DownloadActionsContext>
    );
}
