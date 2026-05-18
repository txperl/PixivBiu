import { createContext } from "react";
import type { ActivityItemId } from "./items";

export interface ActivityBarContextValue {
    items: Partial<Record<ActivityItemId, unknown>>;
    activeItemId: ActivityItemId | null;
    isOpen: boolean;
    toggle: (id: ActivityItemId) => void;
    close: () => void;
    registerItem: (id: ActivityItemId, payload: unknown | null, prevPayload?: unknown) => void;
}

export const ActivityBarContext = createContext<ActivityBarContextValue | null>(null);
