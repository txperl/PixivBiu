import { describe, expect, test } from "bun:test";
import { type EnqueueResult, enqueueSelection, IllustSelectionStore } from "../src/features/downloads/selection-state";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

const options = (visibleIds = [1, 2, 3], identity = "page:1") => ({ identity, visibleIds, enabled: true });
const ids = (store: IllustSelectionStore) => [...store.getSnapshot().selected];

describe("illustration selection", () => {
    test("explicit entry permits zero selection; partial selection can be completed", () => {
        const store = new IllustSelectionStore(options());
        store.enter();
        expect(store.getSnapshot().mode).toBe(true);
        expect(ids(store)).toEqual([]);
        store.configure(options());
        expect(store.getSnapshot().mode).toBe(true);
        store.toggle(2);
        store.selectAll();
        expect(ids(store)).toEqual([1, 2, 3]);
        store.clear();
        expect(ids(store)).toEqual([]);
        expect(store.getSnapshot().mode).toBe(true);
        store.selectAll();
        expect(ids(store)).toEqual([1, 2, 3]);
        store.exit();
        expect(store.getSnapshot().mode).toBe(false);
        expect(ids(store)).toEqual([]);
    });

    test("selecting a card enters; deselecting the last card exits", () => {
        const store = new IllustSelectionStore(options());
        store.toggle(1);
        expect(store.getSnapshot().mode).toBe(true);
        store.toggle(1);
        expect(store.getSnapshot().mode).toBe(false);
    });

    test("loaded works are not selected implicitly, and duplicate ids are normalized", () => {
        const store = new IllustSelectionStore(options([1, 2, 2]));
        store.selectAll();
        store.configure(options([1, 2, 3, 4]));
        expect(ids(store)).toEqual([1, 2]);
        store.selectAll();
        expect(ids(store)).toEqual([1, 2, 3, 4]);
    });

    test("filter/refetch removes only missing selections; no intersection exits", () => {
        const store = new IllustSelectionStore(options());
        store.selectAll();
        store.configure(options([2, 3]));
        expect(ids(store)).toEqual([2, 3]);
        expect(store.getSnapshot().mode).toBe(true);
        store.configure(options([4]));
        expect(ids(store)).toEqual([]);
        expect(store.getSnapshot().mode).toBe(false);
    });

    test("an explicitly entered zero-selection mode exits when filters leave no works", () => {
        const store = new IllustSelectionStore(options());
        store.enter();
        store.configure(options([]));
        expect(store.getSnapshot().mode).toBe(false);
    });

    test("list identity changes exit even if ids overlap", () => {
        const store = new IllustSelectionStore(options());
        store.toggle(1);
        store.configure(options([1, 2, 3], "page:2"));
        expect(store.getSnapshot().mode).toBe(false);
        expect(ids(store)).toEqual([]);
    });

    test("disabled/empty lists cannot enter or select unavailable ids", () => {
        const store = new IllustSelectionStore({ ...options(), enabled: false });
        store.enter();
        store.toggle(1);
        expect(store.getSnapshot().mode).toBe(false);
        store.configure(options([]));
        store.enter();
        store.toggle(99);
        expect(ids(store)).toEqual([]);
    });

    test("hide/reveal subscriptions preserve state and do not restart work", async () => {
        const store = new IllustSelectionStore(options());
        store.toggle(1);
        const request = deferred<EnqueueResult>();
        const unsubscribe = store.subscribe(() => {});
        const batch = store.download(
            () => request.promise,
            () => true,
        );
        unsubscribe();
        request.resolve(null);
        await batch;
        store.configure(options());
        expect(ids(store)).toEqual([1]);
        expect(store.getSnapshot().mode).toBe(true);
        expect(store.getSnapshot().pending).toBeNull();
    });

    test("partial failures retain only failed works and retry only those works", async () => {
        const store = new IllustSelectionStore(options());
        store.selectAll();
        await store.download(
            async (id) => (id === 2 ? null : id === 3 ? "existing" : "added"),
            () => true,
        );
        expect(ids(store)).toEqual([2]);
        expect(store.getSnapshot().result?.added).toEqual([1]);
        expect(store.getSnapshot().result?.existing).toEqual([3]);
        const retried: number[] = [];
        await store.download(
            async (id) => {
                retried.push(id);
                return "added";
            },
            () => true,
        );
        expect(retried).toEqual([2]);
        expect(store.getSnapshot().mode).toBe(false);
        expect(store.getSnapshot().pending).toBeNull();
    });

    test("rejections settle as failures and release the submit lock", async () => {
        const store = new IllustSelectionStore(options([1]));
        store.selectAll();
        await store.download(
            async () => {
                throw new Error("offline");
            },
            () => true,
        );
        expect(ids(store)).toEqual([1]);
        expect(store.getSnapshot().result?.failed).toEqual([1]);
        expect(store.getSnapshot().pending).toBeNull();
    });

    test("duplicate submits and selection edits are locked while pending", async () => {
        const store = new IllustSelectionStore(options());
        store.toggle(1);
        const request = deferred<EnqueueResult>();
        let calls = 0;
        const submit = () => {
            calls++;
            return request.promise;
        };
        const batch = store.download(submit, () => true);
        await store.download(submit, () => true);
        store.toggle(2);
        store.selectAll();
        store.clear();
        expect(calls).toBe(1);
        expect(ids(store)).toEqual([1]);
        request.resolve("added");
        await batch;
        expect(store.getSnapshot().mode).toBe(false);
    });

    test("exit does not stop enqueuing or resurrect failed selection", async () => {
        const store = new IllustSelectionStore(options());
        store.selectAll();
        const request = deferred<EnqueueResult>();
        const batch = store.download(
            () => request.promise,
            () => true,
        );
        store.exit();
        request.resolve(null);
        await batch;
        expect(ids(store)).toEqual([]);
        expect(store.getSnapshot().result).toBeNull();
        expect(store.getSnapshot().mode).toBe(false);
    });

    test("old batches cannot clear or restore another list version", async () => {
        const store = new IllustSelectionStore(options());
        store.selectAll();
        const request = deferred<EnqueueResult>();
        const batch = store.download(
            () => request.promise,
            () => true,
        );
        store.configure(options([1, 4], "page:2"));
        request.resolve(null);
        await batch;
        expect(store.getSnapshot().result).toBeNull();
        expect(ids(store)).toEqual([]);
        store.toggle(4);
        expect(ids(store)).toEqual([4]);
    });
});

describe("batch workers", () => {
    test("at most four requests run together, with authoritative progress", async () => {
        const gates = new Map<number, ReturnType<typeof deferred<EnqueueResult>>>();
        let inFlight = 0;
        let peak = 0;
        const progress: number[] = [];
        const batch = enqueueSelection(
            [1, 2, 3, 4, 5, 6, 7, 8, 8],
            async (id) => {
                inFlight++;
                peak = Math.max(peak, inFlight);
                const gate = deferred<EnqueueResult>();
                gates.set(id, gate);
                const result = await gate.promise;
                inFlight--;
                return result;
            },
            () => true,
            (completed) => progress.push(completed),
        );
        expect(gates.size).toBe(4);
        for (let id = 1; id <= 8; id++) {
            for (let tick = 0; tick < 20 && !gates.has(id); tick++) await Promise.resolve();
            expect(gates.has(id)).toBe(true);
            gates.get(id)?.resolve("added");
        }
        const result = await batch;
        expect(peak).toBe(4);
        expect(result.added).toHaveLength(8);
        expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    test("account disposal stops unsent requests and ignores old results", async () => {
        const store = new IllustSelectionStore(options([1, 2, 3, 4, 5, 6]));
        store.selectAll();
        let current = true;
        const called: number[] = [];
        const request = deferred<EnqueueResult>();
        const batch = store.download(
            (id) => {
                called.push(id);
                return request.promise;
            },
            () => current,
        );
        current = false;
        request.resolve("added");
        await batch;
        expect(called).toEqual([1, 2, 3, 4]);
        expect(store.getSnapshot().result).toBeNull();
        expect(store.getSnapshot().pending).toBeNull();
    });
});
