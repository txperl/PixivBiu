// Reads a value out of a nested config map (e.g. ConfigView.effective /
// .file, which mirror the struct shape) by its dotted key. Returns
// undefined if any segment is missing.
export function nestedGet(obj: unknown, dottedKey: string): unknown {
    let cur: unknown = obj;
    for (const seg of dottedKey.split(".")) {
        if (cur == null || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[seg];
    }
    return cur;
}
