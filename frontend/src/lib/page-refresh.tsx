import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from "react";

type Handler = () => void;

type PageRefreshRegistry = {
    register: (handler: Handler) => () => void;
    refresh: () => boolean;
};

const PageRefreshContext = createContext<PageRefreshRegistry | null>(null);

/**
 * Lets the visible page expose a "refresh" action to app chrome (re-clicking the active
 * sidebar item at the top of its landing view). Handlers register from effects, so a
 * kept-alive page drops out while hidden and only the visible page answers.
 */
export function PageRefreshProvider({ children }: { children: ReactNode }) {
    const handlers = useRef(new Set<Handler>());
    const value = useMemo<PageRefreshRegistry>(
        () => ({
            register: (handler) => {
                handlers.current.add(handler);
                return () => handlers.current.delete(handler);
            },
            refresh: () => {
                for (const h of handlers.current) h();
                return handlers.current.size > 0;
            },
        }),
        [],
    );
    return <PageRefreshContext value={value}>{children}</PageRefreshContext>;
}

/**
 * Registers what "refresh this page" means for the calling page: re-pull its current
 * list from the top, keeping filters and tabs. Pages without a handler are not refreshed.
 */
export function usePageRefresh(handler: Handler) {
    const registry = useContext(PageRefreshContext);
    const latest = useRef(handler);
    latest.current = handler;
    useEffect(() => registry?.register(() => latest.current()), [registry]);
}

/** Refreshes the visible page; returns whether any page handled it. */
export function useRefreshPage(): () => boolean {
    const registry = useContext(PageRefreshContext);
    return registry?.refresh ?? (() => false);
}
