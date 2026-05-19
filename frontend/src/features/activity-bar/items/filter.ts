import type { ReactNode } from "react";
import { useMemo } from "react";
import { useActivityItem, useActivityItemData } from "../use-activity-item";

export const FILTER_ID = "filter" as const;

export type FilterPanelData = {
    specialFilters: ReactNode | null;
    specialFiltersActive: boolean;
    totalBefore: number;
    totalAfter: number;
};

export function useFilterPanel(args: FilterPanelData | null) {
    const specialFilters = args?.specialFilters ?? null;
    const specialFiltersActive = args?.specialFiltersActive ?? false;
    const totalBefore = args?.totalBefore ?? 0;
    const totalAfter = args?.totalAfter ?? 0;
    const isActive = args !== null;

    const payload = useMemo<FilterPanelData | null>(() => {
        if (!isActive) return null;
        return { specialFilters, specialFiltersActive, totalBefore, totalAfter };
    }, [isActive, specialFilters, specialFiltersActive, totalBefore, totalAfter]);

    useActivityItem(FILTER_ID, payload);
}

export function useFilterPanelData(): FilterPanelData | null {
    return useActivityItemData<FilterPanelData>(FILTER_ID);
}
