import { describe, expect, test } from "bun:test";
import type { DownloadJob, DownloadTask } from "../src/features/downloads/api";
import { applyDownloadEvent, DownloadStateStore, type TrackedJob } from "../src/features/downloads/download-store";
import type { InboxEvent } from "../src/features/events";

const task = (id: string, patch: Partial<DownloadTask> = {}): DownloadTask =>
    ({ id, status: "queued", downloaded_bytes: 0, size_bytes: 100, error: null, ...patch }) as DownloadTask;

const job = (illustId: number, jobId: string, patch: Partial<DownloadJob> = {}): DownloadJob =>
    ({
        id: jobId,
        illust_id: illustId,
        status: "running",
        updated_at: "2026-10-05T00:00:00Z",
        tasks: [task(`${jobId}-t1`)],
        ...patch,
    }) as DownloadJob;

const event = (type: string, data: Record<string, unknown>): InboxEvent =>
    ({ id: "1", topic: "download", type, ts: "2026-10-05T00:01:00Z", data }) as unknown as InboxEvent;

function spy(store: DownloadStateStore, illustId: number) {
    const calls = { count: 0 };
    store.subscribeIllust(illustId, () => calls.count++);
    return calls;
}

describe("download state store", () => {
    test("notifies only the illust whose job changed", () => {
        const store = new DownloadStateStore();
        store.upsert(job(1, "a"));
        store.upsert(job(2, "b"));
        const one = spy(store, 1);
        const two = spy(store, 2);
        applyDownloadEvent(
            store,
            event("task.progress", { job_id: "a", task_id: "a-t1", downloaded: 40, total: 100 }),
            () => {},
        );
        expect(one.count).toBe(1);
        expect(two.count).toBe(0);
        expect(store.get(1)?.tasks[0].downloaded_bytes).toBe(40);
    });

    test("a repeated progress value keeps identity and notifies nobody", () => {
        const store = new DownloadStateStore();
        store.upsert(job(1, "a"));
        const ev = event("task.progress", { job_id: "a", task_id: "a-t1", downloaded: 40, total: 100 });
        applyDownloadEvent(store, ev, () => {});
        const before = store.get(1);
        const one = spy(store, 1);
        applyDownloadEvent(store, ev, () => {});
        expect(store.get(1)).toBe(before);
        expect(one.count).toBe(0);
    });

    test("ignores late events for a job the illust no longer tracks", () => {
        const store = new DownloadStateStore();
        store.upsert(job(1, "old"));
        store.upsert(job(1, "new"));
        const one = spy(store, 1);
        applyDownloadEvent(
            store,
            event("task.progress", { job_id: "old", task_id: "old-t1", downloaded: 10, total: 100 }),
            () => {},
        );
        applyDownloadEvent(
            store,
            event("job.completed", { job_id: "old", illust_id: 1, active_count: 0, done_count: 1 }),
            () => {},
        );
        applyDownloadEvent(
            store,
            event("job.deleted", { job_id: "old", illust_id: 1, active_count: 0, done_count: 1 }),
            () => {},
        );
        expect(store.get(1)?.id).toBe("new");
        expect(store.get(1)?.status).toBe("running");
        expect(one.count).toBe(0);
    });

    test("job events set status, stamp terminal time and carry counts", () => {
        const store = new DownloadStateStore();
        store.upsert(job(1, "a", { status: "queued" }));
        applyDownloadEvent(
            store,
            event("job.started", { job_id: "a", illust_id: 1, active_count: 1, done_count: 0 }),
            () => {},
        );
        expect(store.get(1)?.status).toBe("running");
        expect(store.get(1)?.terminatedAt).toBeUndefined();
        applyDownloadEvent(
            store,
            event("job.completed", { job_id: "a", illust_id: 1, active_count: 0, done_count: 3 }),
            () => {},
        );
        expect(store.get(1)?.status).toBe("completed");
        expect(store.get(1)?.terminatedAt).toBe(Date.parse("2026-10-05T00:01:00Z"));
        expect(store.getCounts()).toEqual({ activeCount: 0, doneCount: 3 });
    });

    test("task terminal events patch status, error and completed bytes", () => {
        const store = new DownloadStateStore();
        store.upsert(job(1, "a", { tasks: [task("t1", { status: "running" }), task("t2", { status: "running" })] }));
        applyDownloadEvent(store, event("task.completed", { job_id: "a", task_id: "t1" }), () => {});
        applyDownloadEvent(store, event("task.failed", { job_id: "a", task_id: "t2", error: "boom" }), () => {});
        const [t1, t2] = store.get(1)?.tasks ?? [];
        expect(t1).toMatchObject({ status: "completed", downloaded_bytes: 100 });
        expect(t2).toMatchObject({ status: "failed", error: "boom", downloaded_bytes: 0 });
    });

    test("a queued event for an unknown job asks the caller to fetch it", () => {
        const store = new DownloadStateStore();
        store.upsert(job(1, "a"));
        const unknown: string[] = [];
        applyDownloadEvent(
            store,
            event("job.queued", { job_id: "a", illust_id: 1, active_count: 1, done_count: 0 }),
            (id) => unknown.push(id),
        );
        applyDownloadEvent(
            store,
            event("job.queued", { job_id: "b", illust_id: 2, active_count: 2, done_count: 0 }),
            (id) => unknown.push(id),
        );
        expect(unknown).toEqual(["b"]);
    });

    test("the job index follows replacement and deletion", () => {
        const store = new DownloadStateStore();
        store.upsert(job(1, "a"));
        store.delete(1, "a");
        store.upsert(job(2, "a")); // ids are unique in practice; the index must not point at illust 1
        applyDownloadEvent(
            store,
            event("task.progress", { job_id: "a", task_id: "a-t1", downloaded: 5, total: 100 }),
            () => {},
        );
        expect(store.get(1)).toBeUndefined();
        expect(store.get(2)?.tasks[0].downloaded_bytes).toBe(5);
    });

    test("upserting a terminal job stamps terminatedAt from updated_at", () => {
        const store = new DownloadStateStore();
        store.upsert(job(1, "a", { status: "failed", updated_at: "2026-10-05T00:00:30Z" }));
        expect(store.get(1)?.terminatedAt).toBe(Date.parse("2026-10-05T00:00:30Z"));
    });

    test("replaceAll notifies changed and removed illusts only", () => {
        const store = new DownloadStateStore();
        const kept = job(1, "a");
        store.upsert(kept);
        store.upsert(job(2, "b"));
        const kept1 = store.get(1) as TrackedJob;
        const one = spy(store, 1);
        const two = spy(store, 2);
        const three = spy(store, 3);
        store.replaceAll(
            new Map([
                [1, kept1],
                [3, job(3, "c")],
            ]),
        );
        expect(one.count).toBe(0);
        expect(two.count).toBe(1);
        expect(three.count).toBe(1);
        expect(store.get(2)).toBeUndefined();
    });

    test("sweep evicts only expired terminal jobs", () => {
        const store = new DownloadStateStore();
        store.upsert(job(1, "a"));
        store.upsert(job(2, "b", { status: "completed", updated_at: "2026-10-05T00:00:00Z" }));
        store.upsert(job(3, "c", { status: "completed", updated_at: "2026-10-05T01:00:00Z" }));
        const one = spy(store, 1);
        store.sweep(Date.parse("2026-10-05T00:30:00Z"));
        expect(store.get(1)).toBeDefined();
        expect(store.get(2)).toBeUndefined();
        expect(store.get(3)).toBeDefined();
        expect(one.count).toBe(0);
    });

    test("counts keep identity when unchanged and reset clears everything", () => {
        const store = new DownloadStateStore();
        let notified = 0;
        store.subscribeCounts(() => notified++);
        store.setCounts(2, 5);
        const snapshot = store.getCounts();
        store.setCounts(2, 5);
        expect(store.getCounts()).toBe(snapshot);
        expect(notified).toBe(1);
        store.upsert(job(1, "a"));
        store.reset();
        expect(store.get(1)).toBeUndefined();
        expect(store.getCounts()).toEqual({ activeCount: 0, doneCount: 0 });
    });
});
