import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { ACTIVE_STATUSES } from "./api";
import type { EnqueueResult, IllustSelectionStore } from "./selection-state";
import { useDownloadActions } from "./use-download-mutations";

export type SelectionController = {
    store: IllustSelectionStore;
    restoreFocus: () => void;
};

type SelectionContextValue = {
    active: SelectionController | null;
    register: (controller: SelectionController) => () => void;
    download: (store: IllustSelectionStore) => Promise<void>;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function IllustSelectionProvider({ children }: { children: ReactNode }) {
    const [active, setActive] = useState<SelectionController | null>(null);
    const alive = useRef(true);
    const { store: downloads, submit } = useDownloadActions();

    useLayoutEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const register = useCallback((controller: SelectionController) => {
        setActive(controller);
        return () => setActive((current) => (current === controller ? null : current));
    }, []);

    const download = useCallback(
        async (store: IllustSelectionStore) => {
            const enqueue = async (id: number): Promise<EnqueueResult> => {
                // Read at call time: each enqueue sees jobs the batch already submitted.
                const job = downloads.get(id);
                if (job && ACTIVE_STATUSES.includes(job.status)) return "existing";
                const created = await submit(id);
                return created ? "added" : null;
            };
            await store.download(enqueue, () => alive.current);
        },
        [downloads, submit],
    );

    const value = useMemo(() => ({ active, register, download }), [active, register, download]);
    return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelectionContext() {
    const context = useContext(SelectionContext);
    if (!context) throw new Error("Selection actions require <IllustSelectionProvider>");
    return context;
}
