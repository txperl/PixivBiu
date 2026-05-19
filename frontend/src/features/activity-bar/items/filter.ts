import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useActivityItem, useActivityItemData } from "../use-activity-item";

export const FILTER_ID = "filter" as const;

export type QuickActionData = {
    selected: Set<number>;
    allIllustIds: readonly number[];
    onReplaceSelection: (ids: readonly number[]) => void;
    onClearSelection: () => void;
};

export type FilterPanelData = {
    specialFilters: ReactNode | null;
    specialFiltersActiveCount: number;
    onResetSpecialFilters: (() => void) | null;
    totalBefore: number;
    totalAfter: number;
    quickAction: QuickActionData | null;
};

const EMPTY_IDS: readonly number[] = [];

function sameIds(a: readonly number[], b: readonly number[]) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

export function useFilterPanel(args: FilterPanelData | null) {
    const specialFilters = args?.specialFilters ?? null;
    const specialFiltersActiveCount = args?.specialFiltersActiveCount ?? 0;
    const onResetSpecialFilters = args?.onResetSpecialFilters ?? null;
    const totalBefore = args?.totalBefore ?? 0;
    const totalAfter = args?.totalAfter ?? 0;
    const quickAction = args?.quickAction ?? null;
    const isActive = args !== null;

    // Stabilize by content; pages rebuild this array each render.
    const incomingIds = quickAction?.allIllustIds ?? EMPTY_IDS;
    const idsRef = useRef<readonly number[]>(incomingIds);
    if (!sameIds(idsRef.current, incomingIds)) idsRef.current = incomingIds;
    const stableIds = idsRef.current;

    const selected = quickAction?.selected;
    const onReplaceSelection = quickAction?.onReplaceSelection;
    const onClearSelection = quickAction?.onClearSelection;

    const stableQuickAction = useMemo<QuickActionData | null>(() => {
        if (!selected || !onReplaceSelection || !onClearSelection) return null;
        return {
            selected,
            allIllustIds: stableIds,
            onReplaceSelection,
            onClearSelection,
        };
    }, [selected, stableIds, onReplaceSelection, onClearSelection]);

    const payload = useMemo<FilterPanelData | null>(() => {
        if (!isActive) return null;
        return {
            specialFilters,
            specialFiltersActiveCount,
            onResetSpecialFilters,
            totalBefore,
            totalAfter,
            quickAction: stableQuickAction,
        };
    }, [
        isActive,
        specialFilters,
        specialFiltersActiveCount,
        onResetSpecialFilters,
        totalBefore,
        totalAfter,
        stableQuickAction,
    ]);

    useActivityItem(FILTER_ID, payload);

    // Drop selected ids that fell outside the visible set after filter/refetch.
    // Only stableIds-reference changes introduce drift; toggles add visible ids only.
    const lastIdsRef = useRef<readonly number[] | null>(null);
    useEffect(() => {
        if (lastIdsRef.current === stableIds) return;
        lastIdsRef.current = stableIds;
        if (!selected || selected.size === 0 || !onReplaceSelection) return;
        const allowed = new Set(stableIds);
        const next = Array.from(selected).filter((id) => allowed.has(id));
        if (next.length === selected.size) return;
        onReplaceSelection(next);
    }, [selected, stableIds, onReplaceSelection]);
}

export function useFilterPanelData(): FilterPanelData | null {
    return useActivityItemData<FilterPanelData>(FILTER_ID);
}
