/** Coalesce requests within a session, and never adopt a previous session's response. */
export class ScopedSubmissions<T> {
    private scope: unknown;
    private revision = 0;
    private requests = new Map<number, Promise<T | null>>();

    setScope(scope: unknown) {
        if (this.scope === scope) return;
        this.scope = scope;
        this.revision++;
        this.requests.clear();
    }

    run(id: number, request: () => Promise<T>, accept: (result: T) => void): Promise<T | null> {
        const existing = this.requests.get(id);
        if (existing) return existing;
        const revision = this.revision;
        const promise = Promise.resolve()
            .then(() => (revision === this.revision ? request() : null))
            .then((result) => {
                if (revision !== this.revision || result === null) return null;
                accept(result);
                return result;
            })
            .finally(() => {
                if (this.requests.get(id) === promise) this.requests.delete(id);
            });
        this.requests.set(id, promise);
        return promise;
    }
}
