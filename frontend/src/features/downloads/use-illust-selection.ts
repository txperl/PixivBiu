import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSelectionContext } from "./selection-context";
import { IllustSelectionStore, type SelectionOptions } from "./selection-state";

export function useIllustSelection(options: SelectionOptions) {
    const [store] = useState(() => new IllustSelectionStore(options));
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const { register } = useSelectionContext();
    const { identity, visibleIds, enabled, scope } = options;
    const lastControl = useRef<HTMLElement | null>(null);
    const restoreFocus = useCallback(() => {
        const element = lastControl.current;
        if (!element?.isConnected) return;
        const target =
            element instanceof HTMLInputElement && element.disabled
                ? element.closest<HTMLElement>('[role="button"]')
                : element;
        target?.focus({ preventScroll: true });
    }, []);
    const controller = useMemo(() => ({ store, restoreFocus }), [store, restoreFocus]);

    useLayoutEffect(() => {
        store.configure({ identity, visibleIds, enabled, scope });
    }, [store, identity, visibleIds, enabled, scope]);

    // Activity tears this effect down while hidden, keeping the controller's state.
    useLayoutEffect(() => register(controller), [register, controller]);

    const toggle = useCallback(
        (id: number, control: HTMLElement) => {
            lastControl.current = control;
            store.toggle(id);
        },
        [store],
    );

    return {
        selected: snapshot.selected,
        mode: snapshot.mode,
        disabled: !snapshot.enabled || snapshot.pending !== null,
        toggle,
    };
}
