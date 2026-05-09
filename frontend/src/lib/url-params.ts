export function readPage(sp: URLSearchParams): number {
    const n = Number(sp.get("page"));
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function patchParams(
    current: URLSearchParams,
    patch: Record<string, string | undefined>,
    resetPage = false,
): URLSearchParams {
    const next = new URLSearchParams(current);
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) next.delete(k);
        else next.set(k, v);
    }
    if (resetPage) next.delete("page");
    return next;
}
