import { useEffect } from "react";
import type { ActivityItemId } from "./items";
import { useActivityBar } from "./use-activity-bar";

export function useActivityItem<T>(id: ActivityItemId, payload: T | null): void {
    const { registerItem } = useActivityBar();
    useEffect(() => {
        registerItem(id, payload);
        return () => registerItem(id, null, payload);
    }, [id, payload, registerItem]);
}

export function useActivityItemData<T>(id: ActivityItemId): T | null {
    const { items } = useActivityBar();
    return (items[id] as T | undefined) ?? null;
}
