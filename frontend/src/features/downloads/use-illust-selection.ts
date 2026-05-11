import { useCallback, useMemo, useState } from "react";

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

    const clearSelection = useCallback(() => setSelected(new Set()), []);

    const selectedIllustIds = useMemo(() => [...selected], [selected]);

    return { selected, selectedIllustIds, toggle, clearSelection };
}
