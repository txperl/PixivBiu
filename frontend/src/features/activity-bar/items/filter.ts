import type { ReactNode } from "react";
import { useMemo } from "react";
import { useActivityItem, useActivityItemData } from "../use-activity-item";

export const FILTER_ID = "filter" as const;

export type FilterPanelData = {
    specialFilters: ReactNode | null;
    specialFiltersActiveCount: number;
    onResetSpecialFilters: (() => void) | null;
    totalBefore: number;
    totalAfter: number;
};

export function useFilterPanel(args: FilterPanelData | null) {
    const specialFilters = args?.specialFilters ?? null;
    const specialFiltersActiveCount = args?.specialFiltersActiveCount ?? 0;
    const onResetSpecialFilters = args?.onResetSpecialFilters ?? null;
    const totalBefore = args?.totalBefore ?? 0;
    const totalAfter = args?.totalAfter ?? 0;
    const isActive = args !== null;

    const payload = useMemo<FilterPanelData | null>(() => {
        if (!isActive) return null;
        return { specialFilters, specialFiltersActiveCount, onResetSpecialFilters, totalBefore, totalAfter };
    }, [isActive, specialFilters, specialFiltersActiveCount, onResetSpecialFilters, totalBefore, totalAfter]);

    useActivityItem(FILTER_ID, payload);
}

export function useFilterPanelData(): FilterPanelData | null {
    return useActivityItemData<FilterPanelData>(FILTER_ID);
}
