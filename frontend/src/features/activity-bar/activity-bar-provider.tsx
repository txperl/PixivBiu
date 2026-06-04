import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityBarContext, type ActivityBarContextValue } from "./activity-bar-context";
import { type ActivityItemId, ITEM_DEFS } from "./items";
import { FILTER_ID } from "./items/filter";

type ItemsRegistry = Partial<Record<ActivityItemId, unknown>>;

const STORAGE_KEY = "pixivbiu.activity-bar";
const VALID_ITEM_IDS = new Set<string>(ITEM_DEFS.map((d) => d.id));

type PersistedState = { activeItemId: ActivityItemId | null; isOpen: boolean };

const DEFAULT_STATE: PersistedState = { activeItemId: FILTER_ID, isOpen: true };

function readPersisted(): PersistedState {
    if (typeof window === "undefined") return DEFAULT_STATE;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_STATE;
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        const id =
            typeof parsed.activeItemId === "string" && VALID_ITEM_IDS.has(parsed.activeItemId)
                ? (parsed.activeItemId as ActivityItemId)
                : null;
        return { activeItemId: id, isOpen: id !== null && parsed.isOpen === true };
    } catch {
        return DEFAULT_STATE;
    }
}

function writePersisted(s: PersistedState) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
        // localStorage may be unavailable (private mode / quota)
    }
}

export function ActivityBarProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<ItemsRegistry>({});
    const [activeItemId, setActiveItemId] = useState<ActivityItemId | null>(() => readPersisted().activeItemId);
    const [isOpen, setIsOpen] = useState<boolean>(() => readPersisted().isOpen);

    // Read latest state inside action callbacks without breaking their referential stability.
    const activeItemIdRef = useRef(activeItemId);
    activeItemIdRef.current = activeItemId;
    const isOpenRef = useRef(isOpen);
    isOpenRef.current = isOpen;

    useEffect(() => {
        writePersisted({ activeItemId, isOpen });
    }, [activeItemId, isOpen]);

    // prevPayload guards against an unmount-cleanup wiping a registration that a
    // newer mount has already overwritten in the same commit.
    const registerItem = useCallback((id: ActivityItemId, payload: unknown | null, prevPayload?: unknown) => {
        setItems((prev) => {
            const cur = prev[id];
            if (payload == null) {
                if (cur === undefined || (prevPayload !== undefined && cur !== prevPayload)) return prev;
                const next = { ...prev };
                delete next[id];
                return next;
            }
            if (cur === payload) return prev;
            return { ...prev, [id]: payload };
        });
    }, []);

    const toggle = useCallback((id: ActivityItemId) => {
        if (activeItemIdRef.current === id) {
            setIsOpen(!isOpenRef.current);
        } else {
            setActiveItemId(id);
            setIsOpen(true);
        }
    }, []);

    const close = useCallback(() => setIsOpen(false), []);

    const value = useMemo<ActivityBarContextValue>(
        () => ({ items, activeItemId, isOpen, toggle, close, registerItem }),
        [items, activeItemId, isOpen, toggle, close, registerItem],
    );

    return <ActivityBarContext.Provider value={value}>{children}</ActivityBarContext.Provider>;
}
