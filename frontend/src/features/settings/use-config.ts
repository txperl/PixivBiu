import { useCallback, useEffect, useState } from "react";
import { useRefreshOnReconnect } from "@/features/events";
import type { FetchState } from "@/lib/fetch-state";
import { type ConfigApiError, type ConfigView, getConfig, getConfigSchema } from "./api";
import { compileSchema } from "./compile-schema";
import { EXPECTED_SCHEMA_VERSION } from "./presentation";
import type { SectionSpec } from "./types";

export interface UseConfigResult {
    loadState: FetchState<true>;
    sections: SectionSpec[];
    view: ConfigView | null;
    setView: (view: ConfigView) => void;
    refetch: () => Promise<void>;
    // Polls /config after a restart until the new process answers with the
    // given keys no longer pending, then adopts that view. Resolves on
    // recovery or after a timeout.
    awaitRestart: (keys: string[]) => Promise<void>;
    // True when the running backend's schema version differs from the one
    // this UI was built against.
    schemaMismatch: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RESTART_POLL_INTERVAL = 1500;
const RESTART_POLL_TIMEOUT = 60_000;

// Loads the config schema (static, drives the form layout) and the current
// values in parallel, then keeps values fresh across SSE reconnects — which
// is how the restart flow recovers once the process comes back.
export function useConfig(): UseConfigResult {
    const [loadState, setLoadState] = useState<FetchState<true>>({ status: "idle" });
    const [sections, setSections] = useState<SectionSpec[]>([]);
    const [view, setView] = useState<ConfigView | null>(null);
    const [schemaMismatch, setSchemaMismatch] = useState(false);

    const load = useCallback(async () => {
        setLoadState({ status: "loading" });
        const [cfg, schema] = await Promise.all([getConfig(), getConfigSchema()]);
        const error: ConfigApiError | null = cfg.error ?? schema.error;
        if (error) {
            setLoadState({ status: "error", error });
            return;
        }
        if (cfg.data && schema.data) {
            setSections(compileSchema(schema.data));
            setView(cfg.data);
            const version = schema.data["x-cfg-schema-version"] ?? cfg.data.schema_version;
            setSchemaMismatch(version !== EXPECTED_SCHEMA_VERSION);
            setLoadState({ status: "success", data: true });
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    // Adopt a freshly fetched view only when it actually differs. A
    // reconnect/poll that returns identical data must not re-run the form's
    // reconcile effect — that would, among other things, wipe an in-progress
    // sensitive-field edit.
    const applyView = useCallback((next: ConfigView) => {
        setView((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }, []);

    // Re-pull only the values (schema is static) after a reconnect/resync.
    const refetch = useCallback(async () => {
        const { data } = await getConfig();
        if (data) applyView(data);
    }, [applyView]);

    useRefreshOnReconnect(refetch);

    // A restart makes the backend drain, re-exec, and come back on the same
    // port. We can't rely on the SSE `connected` flag flipping (the browser's
    // EventSource auto-reconnects without a clean disconnected→connected edge),
    // so we poll /config directly. During the drain window the old process
    // either refuses the request (no data) or still reports the keys as
    // pending; we only adopt a view once those keys have cleared, which marks
    // the new process as up.
    const awaitRestart = useCallback(
        async (keys: string[]) => {
            // During the drain/re-exec gap the server refuses connections, so
            // getConfig() rejects; swallow that and keep polling.
            const tryGet = async () => {
                try {
                    return (await getConfig()).data;
                } catch {
                    return null;
                }
            };
            const deadline = Date.now() + RESTART_POLL_TIMEOUT;
            await sleep(RESTART_POLL_INTERVAL);
            while (Date.now() < deadline) {
                const data = await tryGet();
                if (data && !keys.some((k) => data.pending_restart.includes(k))) {
                    applyView(data);
                    return;
                }
                await sleep(RESTART_POLL_INTERVAL);
            }
            // Timed out — adopt whatever the server reports so the UI stops waiting.
            const data = await tryGet();
            if (data) applyView(data);
        },
        [applyView],
    );

    return { loadState, sections, view, setView: applyView, refetch, awaitRestart, schemaMismatch };
}
