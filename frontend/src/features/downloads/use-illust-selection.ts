import { useCallback, useState } from "react";

export function useIllustSelection() {
    const [selected, setSelected] = useState<Set<number>>(new Set());

    const toggle = useCallback((id: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const replaceSelection = useCallback((ids: readonly number[]) => {
        setSelected(new Set(ids));
    }, []);

    const clearSelection = useCallback(() => setSelected(new Set()), []);

    return { selected, toggle, replaceSelection, clearSelection };
}
