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
import { useDownloadMutations } from "./use-download-mutations";
import { useTrackedDownloads } from "./use-tracked-downloads";

type SelectionContextValue = {
    active: IllustSelectionStore | null;
    register: (store: IllustSelectionStore) => () => void;
    download: (store: IllustSelectionStore) => Promise<void>;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function IllustSelectionProvider({ children }: { children: ReactNode }) {
    const [active, setActive] = useState<IllustSelectionStore | null>(null);
    const alive = useRef(true);
    const { submit } = useDownloadMutations();
    const { tracked } = useTrackedDownloads();
    const latest = useRef({ submit, tracked });
    latest.current = { submit, tracked };

    useLayoutEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const register = useCallback((store: IllustSelectionStore) => {
        setActive(store);
        return () => setActive((current) => (current === store ? null : current));
    }, []);

    const download = useCallback(async (store: IllustSelectionStore) => {
        const enqueue = async (id: number): Promise<EnqueueResult> => {
            const job = latest.current.tracked.get(id);
            if (job && ACTIVE_STATUSES.includes(job.status)) return "existing";
            const created = await latest.current.submit(id);
            return created ? "added" : null;
        };
        await store.download(enqueue, () => alive.current);
    }, []);

    const value = useMemo(() => ({ active, register, download }), [active, register, download]);
    return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelectionContext() {
    const context = useContext(SelectionContext);
    if (!context) throw new Error("Selection actions require <IllustSelectionProvider>");
    return context;
}
