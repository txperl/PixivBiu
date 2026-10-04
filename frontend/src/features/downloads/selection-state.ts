export type SelectionScope = "page" | "loaded";
export type EnqueueResult = "added" | "existing" | null;
export type BatchResult = { added: number[]; existing: number[]; failed: number[] };
export type SelectionSnapshot = {
    mode: boolean;
    selected: ReadonlySet<number>;
    visibleIds: readonly number[];
    enabled: boolean;
    scope: SelectionScope;
    pending: { completed: number; total: number } | null;
    result: (BatchResult & { finishedAt: number }) | null;
};

export type SelectionOptions = {
    identity: string;
    visibleIds: readonly number[];
    enabled: boolean;
    scope?: SelectionScope;
};

export async function enqueueSelection(
    ids: readonly number[],
    enqueue: (id: number) => Promise<EnqueueResult>,
    isCurrent: () => boolean,
    onProgress: (completed: number) => void,
): Promise<BatchResult> {
    const result: BatchResult = { added: [], existing: [], failed: [] };
    const uniqueIds = [...new Set(ids)];
    let cursor = 0;
    let completed = 0;
    const worker = async () => {
        while (isCurrent() && cursor < uniqueIds.length) {
            const id = uniqueIds[cursor++];
            let outcome: EnqueueResult = null;
            try {
                outcome = await enqueue(id);
            } catch {
                // One rejected request must not strand the other workers or the UI.
            }
            if (!isCurrent()) return;
            if (outcome === "added") result.added.push(id);
            else if (outcome === "existing") result.existing.push(id);
            else result.failed.push(id);
            onProgress(++completed);
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, uniqueIds.length) }, worker));
    return result;
}

/** Page-local state survives Activity hiding; async work never reads another page's selection. */
export class IllustSelectionStore {
    private static nextId = 0;
    readonly id = IllustSelectionStore.nextId++;
    private identity: string;
    private revision = 0;
    private batch: { revision: number } | null = null;
    private listeners = new Set<() => void>();
    private snapshot: SelectionSnapshot;

    constructor(options: SelectionOptions) {
        this.identity = options.identity;
        this.snapshot = {
            mode: false,
            selected: new Set(),
            visibleIds: options.enabled ? [...new Set(options.visibleIds)] : [],
            enabled: options.enabled,
            scope: options.scope ?? "page",
            pending: null,
            result: null,
        };
    }

    getSnapshot = () => this.snapshot;

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private update(patch: Partial<SelectionSnapshot>) {
        this.snapshot = { ...this.snapshot, ...patch };
        for (const listener of this.listeners) listener();
    }

    configure(options: SelectionOptions) {
        const scope = options.scope ?? "page";
        const changedIdentity = this.identity !== options.identity;
        // Loading/placeholder data is not an authoritative empty result. Keep the last
        // same-list IDs until usable results arrive, while disabling selection edits.
        const ids = options.enabled
            ? [...new Set(options.visibleIds)]
            : changedIdentity
              ? []
              : this.snapshot.visibleIds;
        const allowed = new Set(ids);
        const selected = new Set([...this.snapshot.selected].filter((id) => allowed.has(id)));
        const pruned = selected.size !== this.snapshot.selected.size;
        const reset = changedIdentity || (options.enabled && ids.length === 0);
        const needsReset = reset && this.snapshot.mode;
        this.identity = options.identity;
        const sameIds =
            ids.length === this.snapshot.visibleIds.length && ids.every((id, i) => id === this.snapshot.visibleIds[i]);
        if (
            !changedIdentity &&
            !pruned &&
            !needsReset &&
            sameIds &&
            options.enabled === this.snapshot.enabled &&
            scope === this.snapshot.scope
        )
            return;
        // A new list owns its own lock; the captured old batch continues independently.
        if (reset) {
            this.revision++;
            this.batch = null;
        } else if (pruned && selected.size === 0) {
            this.revision++;
        }
        this.update({
            visibleIds: ids,
            enabled: options.enabled,
            scope,
            selected: reset ? new Set() : selected,
            mode: reset || (pruned && selected.size === 0) ? false : this.snapshot.mode,
            pending: reset ? null : this.snapshot.pending,
            result: reset || pruned ? null : this.snapshot.result,
        });
    }

    exit = () => {
        this.revision++;
        this.update({ mode: false, selected: new Set(), result: null });
    };

    private get editable() {
        return this.snapshot.enabled && !this.snapshot.pending && this.snapshot.visibleIds.length > 0;
    }

    toggle = (id: number) => {
        if (!this.editable || !this.snapshot.visibleIds.includes(id)) return;
        const selected = new Set(this.snapshot.selected);
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        this.revision++;
        this.update({ selected, mode: selected.size > 0, result: null });
    };

    // Match the filter-panel action: any selection clears, zero selection selects all.
    toggleAll = () => {
        if (!this.editable) return;
        const selected = new Set(this.snapshot.selected.size > 0 ? [] : this.snapshot.visibleIds);
        this.revision++;
        this.update({ selected, mode: true, result: null });
    };

    dismissResult = () => {
        if (this.snapshot.result) this.update({ result: null });
    };

    download = async (enqueue: (id: number) => Promise<EnqueueResult>, isCurrent: () => boolean) => {
        if (!this.editable || this.snapshot.selected.size === 0 || !isCurrent()) return;
        const ids = [...this.snapshot.selected];
        const batch = { revision: this.revision };
        this.batch = batch;
        const ownsSelection = () => this.batch === batch && batch.revision === this.revision && isCurrent();
        this.update({ pending: { completed: 0, total: ids.length }, result: null });
        try {
            const result = await enqueueSelection(ids, enqueue, isCurrent, (completed) => {
                if (ownsSelection()) this.update({ pending: { completed, total: ids.length } });
            });
            if (!ownsSelection()) return;
            const allowed = new Set(this.snapshot.visibleIds);
            const selected = new Set(result.failed.filter((id) => allowed.has(id)));
            this.update({ selected, mode: selected.size > 0, result: { ...result, finishedAt: Date.now() } });
        } finally {
            if (this.batch === batch) {
                this.batch = null;
                this.update({ pending: null });
            }
        }
    };
}
