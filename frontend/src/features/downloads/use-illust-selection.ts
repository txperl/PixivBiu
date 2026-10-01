import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { APP_SCROLLER_SELECTOR } from "@/lib/scroll";
import { useSelectionContext } from "./selection-context";
import { IllustSelectionStore, type SelectionOptions } from "./selection-state";

export function useIllustSelection(options: SelectionOptions) {
    const [store] = useState(() => new IllustSelectionStore(options));
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const { register } = useSelectionContext();
    const { identity, visibleIds, enabled, scope } = options;

    useLayoutEffect(() => {
        store.configure({ identity, visibleIds, enabled, scope });
    }, [store, identity, visibleIds, enabled, scope]);

    // Activity tears this effect down while hidden, keeping the controller's state.
    useLayoutEffect(() => register(store), [register, store]);

    const toggle = useCallback(
        (id: number) => {
            const element = document.activeElement;
            if (element instanceof HTMLElement && element.closest(APP_SCROLLER_SELECTOR)) {
                store.restoreFocus = () => {
                    if (!element.isConnected) return;
                    const target =
                        element instanceof HTMLInputElement && element.disabled
                            ? element.closest<HTMLElement>('[role="button"]')
                            : element;
                    target?.focus({ preventScroll: true });
                };
            }
            store.toggle(id);
        },
        [store],
    );

    return { ...snapshot, store, toggle };
}
