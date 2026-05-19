import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { components } from "@/lib/api";
import { applyGeneralFilters } from "./apply";
import { getSnapshot, resetFilters, setFilters, subscribe } from "./store";
import type { GeneralFilters } from "./types";

type Illust = components["schemas"]["Illust"];

export function useGeneralFilters(): {
    filters: GeneralFilters;
    setFilters: (patch: Partial<GeneralFilters>) => void;
    resetFilters: () => void;
} {
    const filters = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const set = useCallback((patch: Partial<GeneralFilters>) => setFilters(patch), []);
    const reset = useCallback(() => resetFilters(), []);
    return { filters, setFilters: set, resetFilters: reset };
}

export function useFilteredIllusts(raw: readonly Illust[] | undefined): {
    filtered: Illust[];
    totalBefore: number;
    totalAfter: number;
} {
    const filters = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const filtered = useMemo(() => (raw ? applyGeneralFilters(raw, filters) : []), [raw, filters]);
    return { filtered, totalBefore: raw?.length ?? 0, totalAfter: filtered.length };
}
