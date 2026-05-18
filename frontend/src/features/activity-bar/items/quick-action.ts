import { useMemo, useRef } from "react";
import { useActivityItem, useActivityItemData } from "../use-activity-item";

export const QUICK_ACTION_ID = "quickAction" as const;

export type QuickActionData = {
    selected: Set<number>;
    allIllustIds: number[];
    onReplaceSelection: (ids: number[]) => void;
    onClearSelection: () => void;
};

const EMPTY_IDS: readonly number[] = [];

function sameIds(a: readonly number[], b: readonly number[]) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

// Pass `null` to opt out — the Panel falls back to its EmptyState.
export function useQuickActionPanel(args: QuickActionData | null) {
    const selected = args?.selected;
    const incomingIds = args?.allIllustIds ?? EMPTY_IDS;
    const onReplaceSelection = args?.onReplaceSelection;
    const onClearSelection = args?.onClearSelection;

    // Stabilize allIllustIds by content: pages rebuild it via .map() each render.
    const idsRef = useRef<readonly number[]>(incomingIds);
    if (!sameIds(idsRef.current, incomingIds)) idsRef.current = incomingIds;
    const stableIds = idsRef.current;

    const payload = useMemo<QuickActionData | null>(() => {
        if (!selected || !onReplaceSelection || !onClearSelection) return null;
        return { selected, allIllustIds: stableIds as number[], onReplaceSelection, onClearSelection };
    }, [selected, stableIds, onReplaceSelection, onClearSelection]);

    useActivityItem(QUICK_ACTION_ID, payload);
}

export function useQuickActionData(): QuickActionData | null {
    return useActivityItemData<QuickActionData>(QUICK_ACTION_ID);
}
