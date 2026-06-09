import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import type { Illust } from "@/features/illusts/api";
import { patchParams } from "@/lib/url-params";
import IllustViewerDialog from "./illust-viewer-dialog";

type IllustViewerValue = {
    open: (illust: Illust) => void;
    close: () => void;
};

const IllustViewerContext = createContext<IllustViewerValue | null>(null);

const PARAM = "illust";

// Single, app-wide artwork viewer. The URL (?illust=<id>) is the source of truth —
// open() pushes it (so the browser Back button closes), close() removes it with a
// history replace (so Back/Forward never re-opens a dismissed dialog). One dialog
// instance is rendered here; every IllustCard reaches it via useIllustViewer(),
// so no list/grid prop plumbing is needed. Must be mounted inside the Router.
export function IllustViewerProvider({ children }: { children: ReactNode }) {
    const [searchParams, setSearchParams] = useSearchParams();
    // Last clicked work, used to render the dialog instantly without a fetch. A cold
    // deep-link (?illust=<id> on first load) has no seed and the dialog fetches by id.
    const [seed, setSeed] = useState<Illust | null>(null);

    const rawId = searchParams.get(PARAM);
    const parsed = rawId != null ? Number(rawId) : Number.NaN;
    const illustId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

    // Read setSearchParams through a ref so open/close (and thus the context value)
    // keep a constant identity. react-router recreates setSearchParams on every
    // navigation; without this, every useIllustViewer() consumer — 100+ IllustCards —
    // would re-render whenever any search param changes.
    const setParamsRef = useRef(setSearchParams);
    setParamsRef.current = setSearchParams;

    const open = useCallback((illust: Illust) => {
        setSeed(illust);
        setParamsRef.current((prev) => patchParams(prev, { [PARAM]: String(illust.id) }));
    }, []);

    const close = useCallback(() => {
        setParamsRef.current((prev) => patchParams(prev, { [PARAM]: undefined }), { replace: true });
    }, []);

    const value = useMemo(() => ({ open, close }), [open, close]);

    return (
        <IllustViewerContext.Provider value={value}>
            {children}
            <IllustViewerDialog illustId={illustId} seed={seed && seed.id === illustId ? seed : null} onClose={close} />
        </IllustViewerContext.Provider>
    );
}

export function useIllustViewer(): IllustViewerValue {
    const ctx = useContext(IllustViewerContext);
    if (!ctx) throw new Error("useIllustViewer must be used inside <IllustViewerProvider>");
    return ctx;
}
