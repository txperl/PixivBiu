import type { InboxEvent } from "@/features/events";
import { type DownloadJob, type DownloadStatus, type DownloadTask, isTerminalStatus } from "./api";
import { patchJobTask } from "./task-patch";
import type {
    JobEventData,
    TaskCancelledData,
    TaskCompletedData,
    TaskFailedData,
    TaskProgressData,
    TaskStartedData,
} from "./types";

// TrackedJob is a DownloadJob plus the timestamp at which it entered a
// terminal state, used by the sweep to evict expired entries. Active jobs
// leave terminatedAt undefined.
export type TrackedJob = DownloadJob & { terminatedAt?: number };

// Global aggregates pushed by the backend on every job lifecycle event.
// activeCount = queued + running; doneCount = completed only.
export type DownloadCounts = { activeCount: number; doneCount: number };

const EMPTY_COUNTS: DownloadCounts = { activeCount: 0, doneCount: 0 };

// Auto-stamp terminatedAt when the inserted job is already terminal, so a job
// that finished before we fetched it still expires on the TTL sweep.
export function toTrackedJob(job: DownloadJob): TrackedJob {
    return isTerminalStatus(job.status) ? { ...job, terminatedAt: Date.parse(job.updated_at) || Date.now() } : job;
}

// The most recent job per illust: queued/running jobs plus terminal ones
// younger than TRACKED_TTL_MS. Subscriptions are per illust, so a progress
// tick re-renders only the controls showing that illust, not every card in
// every kept-alive page. Job objects are immutable; an unchanged job keeps
// its identity and notifies nobody.
export class DownloadStateStore {
    private jobs = new Map<number, TrackedJob>();
    // Task events carry job_id but not illust_id.
    private illustByJob = new Map<string, number>();
    private illustListeners = new Map<number, Set<() => void>>();
    private countListeners = new Set<() => void>();
    private counts = EMPTY_COUNTS;

    get = (illustId: number): TrackedJob | undefined => this.jobs.get(illustId);

    subscribeIllust = (illustId: number, listener: () => void) => {
        let set = this.illustListeners.get(illustId);
        if (!set) {
            set = new Set();
            this.illustListeners.set(illustId, set);
        }
        set.add(listener);
        return () => {
            set.delete(listener);
            if (set.size === 0 && this.illustListeners.get(illustId) === set) this.illustListeners.delete(illustId);
        };
    };

    getCounts = () => this.counts;

    subscribeCounts = (listener: () => void) => {
        this.countListeners.add(listener);
        return () => {
            this.countListeners.delete(listener);
        };
    };

    setCounts(activeCount: number, doneCount: number) {
        if (this.counts.activeCount === activeCount && this.counts.doneCount === doneCount) return;
        this.counts = { activeCount, doneCount };
        for (const listener of [...this.countListeners]) listener();
    }

    upsert(job: DownloadJob) {
        this.set(job.illust_id, toTrackedJob(job));
    }

    // The job_id check guards against late events landing on a slot that a
    // newer job has already claimed (same illust, fresh submission).
    mutate(illustId: number, jobId: string, patch: (job: TrackedJob) => TrackedJob) {
        const cur = this.jobs.get(illustId);
        if (!cur || cur.id !== jobId) return;
        const next = patch(cur);
        if (next !== cur) this.set(illustId, next);
    }

    patchTask(jobId: string, taskId: string, patcher: (task: DownloadTask) => DownloadTask) {
        const illustId = this.illustByJob.get(jobId);
        if (illustId === undefined) return;
        this.mutate(illustId, jobId, (job) => patchJobTask(job, taskId, patcher));
    }

    delete(illustId: number, jobId: string) {
        if (this.jobs.get(illustId)?.id === jobId) this.set(illustId, undefined);
    }

    // Adopt an authoritative snapshot, notifying only illusts whose entry changed.
    replaceAll(next: ReadonlyMap<number, TrackedJob>) {
        for (const illustId of [...this.jobs.keys()]) {
            if (!next.has(illustId)) this.set(illustId, undefined);
        }
        for (const [illustId, job] of next) this.set(illustId, job);
    }

    sweep(cutoff: number) {
        for (const [illustId, job] of [...this.jobs]) {
            if (job.terminatedAt !== undefined && job.terminatedAt < cutoff) this.set(illustId, undefined);
        }
    }

    reset() {
        this.replaceAll(new Map());
        this.setCounts(0, 0);
    }

    private set(illustId: number, job: TrackedJob | undefined) {
        const cur = this.jobs.get(illustId);
        if (cur === job) return;
        if (cur && this.illustByJob.get(cur.id) === illustId) this.illustByJob.delete(cur.id);
        if (job) {
            this.jobs.set(illustId, job);
            this.illustByJob.set(job.id, illustId);
        } else {
            this.jobs.delete(illustId);
        }
        const listeners = this.illustListeners.get(illustId);
        if (listeners) for (const listener of [...listeners]) listener();
    }
}

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

// Applies one `download` inbox event. An unknown queued job (submitted from
// another tab or client) is reported through onUnknownJob so the caller can
// fetch it within its current session.
export function applyDownloadEvent(store: DownloadStateStore, ev: InboxEvent, onUnknownJob: (jobId: string) => void) {
    // job.* events carry the latest counts; task.* events don't, to avoid
    // emitting counts on every progress tick.
    if (ev.type.startsWith("job.")) {
        const d = ev.data as JobEventData;
        store.setCounts(d.active_count, d.done_count);
    }

    switch (ev.type) {
        case "job.queued": {
            const d = ev.data as JobEventData;
            if (store.get(d.illust_id)?.id !== d.job_id) onUnknownJob(d.job_id);
            return;
        }
        case "job.started":
        case "job.completed":
        case "job.failed":
        case "job.cancelled": {
            const d = ev.data as JobEventData;
            const newStatus = JOB_EVENT_STATUS[ev.type];
            const terminal = isTerminalStatus(newStatus);
            store.mutate(d.illust_id, d.job_id, (cur) => {
                if (cur.status === newStatus && !!cur.terminatedAt === terminal) return cur;
                const next: TrackedJob = { ...cur, status: newStatus, updated_at: ev.ts };
                if (terminal) next.terminatedAt = Date.parse(ev.ts) || Date.now();
                return next;
            });
            return;
        }
        case "job.deleted": {
            const d = ev.data as JobEventData;
            store.delete(d.illust_id, d.job_id);
            return;
        }
        case "task.started": {
            const d = ev.data as TaskStartedData;
            store.patchTask(d.job_id, d.task_id, (t) =>
                t.status === "running" ? t : { ...t, status: "running" as DownloadStatus },
            );
            return;
        }
        case "task.progress": {
            const d = ev.data as TaskProgressData;
            store.patchTask(d.job_id, d.task_id, (t) => {
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
            store.patchTask(d.job_id, d.task_id, (t) => ({
                ...t,
                status: newStatus,
                error: failureError ?? t.error ?? null,
                downloaded_bytes: newStatus === "completed" && t.size_bytes > 0 ? t.size_bytes : t.downloaded_bytes,
            }));
            return;
        }
    }
}
