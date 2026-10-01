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
    restoreFocus: (() => void) | undefined;
    private identity: string;
    private version = 0;
    private listeners = new Set<() => void>();
    private snapshot: SelectionSnapshot;

    constructor(options: SelectionOptions) {
        this.identity = options.identity;
        this.snapshot = {
            mode: false,
            selected: new Set(),
            visibleIds: [...new Set(options.visibleIds)],
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
        const ids = [...new Set(options.visibleIds)];
        const scope = options.scope ?? "page";
        const changedIdentity = this.identity !== options.identity;
        const allowed = new Set(ids);
        const selected = new Set([...this.snapshot.selected].filter((id) => allowed.has(id)));
        const pruned = selected.size !== this.snapshot.selected.size;
        const disabled = (!options.enabled || ids.length === 0) && this.snapshot.mode;
        this.identity = options.identity;
        if (changedIdentity || pruned || disabled) this.version++;
        const reset = changedIdentity || !options.enabled || ids.length === 0;
        const sameIds =
            ids.length === this.snapshot.visibleIds.length && ids.every((id, i) => id === this.snapshot.visibleIds[i]);
        if (
            !changedIdentity &&
            !pruned &&
            !disabled &&
            sameIds &&
            options.enabled === this.snapshot.enabled &&
            scope === this.snapshot.scope
        )
            return;
        this.update({
            visibleIds: ids,
            enabled: options.enabled,
            scope,
            selected: reset ? new Set() : selected,
            mode: reset || (pruned && selected.size === 0) ? false : this.snapshot.mode,
            result: changedIdentity || pruned || disabled ? null : this.snapshot.result,
        });
    }

    enter = () => {
        if (!this.snapshot.enabled || this.snapshot.pending || this.snapshot.visibleIds.length === 0) return;
        this.version++;
        this.update({ mode: true, result: null });
    };

    exit = () => {
        this.version++;
        this.update({ mode: false, selected: new Set(), result: null });
    };

    toggle = (id: number) => {
        if (!this.snapshot.enabled || this.snapshot.pending || !this.snapshot.visibleIds.includes(id)) return;
        const selected = new Set(this.snapshot.selected);
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        this.version++;
        this.update({ selected, mode: selected.size > 0, result: null });
    };

    selectAll = () => {
        if (!this.snapshot.enabled || this.snapshot.pending || this.snapshot.visibleIds.length === 0) return;
        this.version++;
        this.update({ selected: new Set(this.snapshot.visibleIds), mode: true, result: null });
    };

    clear = () => {
        if (this.snapshot.pending) return;
        this.version++;
        this.update({ selected: new Set(), result: null });
    };

    dismissResult = () => {
        if (this.snapshot.result) this.update({ result: null });
    };

    download = async (enqueue: (id: number) => Promise<EnqueueResult>, isCurrent: () => boolean) => {
        if (!this.snapshot.enabled || this.snapshot.pending || this.snapshot.selected.size === 0 || !isCurrent())
            return;
        const ids = [...this.snapshot.selected];
        const version = this.version;
        this.update({ pending: { completed: 0, total: ids.length }, result: null });
        try {
            const result = await enqueueSelection(ids, enqueue, isCurrent, (completed) => {
                if (isCurrent()) this.update({ pending: { completed, total: ids.length } });
            });
            if (!isCurrent() || version !== this.version) return;
            const allowed = new Set(this.snapshot.visibleIds);
            const selected = new Set(result.failed.filter((id) => allowed.has(id)));
            this.update({ selected, mode: selected.size > 0, result: { ...result, finishedAt: Date.now() } });
        } finally {
            this.update({ pending: null });
        }
    };
}
