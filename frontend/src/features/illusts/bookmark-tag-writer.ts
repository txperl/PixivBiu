type Options = {
    initial: string[];
    save: (tags: string[]) => Promise<boolean>;
    onChange: (tags: string[]) => void;
    onSaving: (saving: boolean) => void;
};

const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((tag) => b.includes(tag));

// Keep the latest selection while one write is running. A failed write ends the
// batch and restores the last confirmed selection; retry requires a new action.
export function createBookmarkTagWriter({ initial, save, onChange, onSaving }: Options) {
    let confirmed = [...initial];
    let queued: string[] | undefined;
    let running: Promise<void> | undefined;
    const flush = async () => {
        while (queued) {
            const next = queued;
            queued = undefined;
            if (sameTags(next, confirmed)) continue;
            let saved = false;
            try {
                saved = await save(next);
            } catch {
                // The mutation owns error reporting and optimistic rollback.
            }
            if (!saved) {
                queued = undefined;
                onChange(confirmed);
                break;
            }
            confirmed = next;
        }
    };
    const start = () => {
        if (running) return;
        onSaving(true);
        running = Promise.resolve()
            .then(flush)
            .finally(() => {
                running = undefined;
                if (queued) start();
                else onSaving(false);
            });
    };
    return {
        get pending() {
            return running !== undefined || queued !== undefined;
        },
        synchronize(tags: string[]) {
            if (running || queued) return false;
            const changed = !sameTags(confirmed, tags);
            confirmed = [...tags];
            if (changed) onChange(confirmed);
            return true;
        },
        change(tags: string[]) {
            queued = [...tags];
            onChange(queued);
            start();
        },
        async settled() {
            while (running) await running;
        },
    };
}
