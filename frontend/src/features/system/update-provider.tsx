import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pollUntil } from "@/lib/poll";
import {
    applyUpdate,
    checkForUpdate,
    getSystemVersion,
    getUpdateStatus,
    type SystemVersion,
    type UpdateApiError,
    type UpdateStatus,
} from "./api";
import { UpdateContext, type UpdateContextValue } from "./update-context";

// Re-read the cached status so the sidebar dot reflects the backend's background
// discovery without the user clicking anything. Two cadences: a slow steady-state
// poll (the cached value moves at most ~daily) plus a brief fast "catch-up" right
// after mount, because the backend runs its own first check ~10s after boot — a
// page that mounted before then would otherwise sit on a stale "up to date" until
// the slow poll ~30 min later.
const SLOW_POLL_INTERVAL_MS = 30 * 60_000;
const FAST_POLL_INTERVAL_MS = 5_000;
// Cap the fast phase (~2 min) so a disabled checker — which never stamps
// last_checked, our "first check landed" signal — doesn't fast-poll forever.
const FAST_POLL_MAX_ATTEMPTS = 24;

// After apply, the binary swaps and the process re-execs. We poll for the new
// version to come back before reloading the (new) embedded SPA.
const RESTART_POLL_INTERVAL = 1500;
const RESTART_POLL_TIMEOUT = 120_000;

export function UpdateProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<UpdateStatus | null>(null);
    const [systemVersion, setSystemVersion] = useState<SystemVersion | null>(null);
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [applying, setApplying] = useState(false);

    // Adopt a status only when it actually differs, so an identical poll result
    // doesn't churn the context value and re-render every consumer (the sidebar
    // dot, the About panel). Mirrors useConfig's applyView.
    const adoptStatus = useCallback((next: UpdateStatus) => {
        setStatus((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }, []);

    const refresh = useCallback(async () => {
        const { data } = await getUpdateStatus();
        if (data) adoptStatus(data);
    }, [adoptStatus]);

    // Initial load: cached status + build info, both open (no auth).
    useEffect(() => {
        let alive = true;
        void (async () => {
            const [st, ver] = await Promise.all([getUpdateStatus(), getSystemVersion()]);
            if (!alive) return;
            if (st.data) adoptStatus(st.data);
            if (ver.data) setSystemVersion(ver.data);
            setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, [adoptStatus]);

    // Slow steady-state refresh.
    useEffect(() => {
        const id = setInterval(() => void refresh(), SLOW_POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [refresh]);

    // Fast catch-up until the backend's first check lands. Check() stamps
    // last_checked even when it fails, so this stops as soon as the backend has
    // checked once; the attempt cap is the backstop for the disabled case where
    // last_checked never appears.
    const checkedOnce = !!status?.last_checked;
    useEffect(() => {
        if (checkedOnce) return;
        let n = 0;
        const id = setInterval(() => {
            void refresh();
            if (++n >= FAST_POLL_MAX_ATTEMPTS) clearInterval(id);
        }, FAST_POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [refresh, checkedOnce]);

    const checkNow = useCallback(async (): Promise<UpdateApiError | null> => {
        setChecking(true);
        try {
            const { data, error } = await checkForUpdate();
            if (data) adoptStatus(data);
            return error;
        } finally {
            setChecking(false);
        }
    }, [adoptStatus]);

    // apply only reads the current version at call time; keep it in a ref so the
    // callback stays stable and never churns the context value.
    const currentVersionRef = useRef("");
    currentVersionRef.current = status?.current_version ?? systemVersion?.version ?? "";

    // applyingRef gates re-entry synchronously: a real apply spends a long time
    // downloading/verifying/swapping the binary before applyUpdate() resolves,
    // and `applying` state alone updates a render later — so a rapid double-click
    // could otherwise fire concurrent POST /system/update/apply requests.
    const applyingRef = useRef(false);

    const apply = useCallback(async (): Promise<UpdateApiError | null> => {
        if (applyingRef.current) return null;
        applyingRef.current = true;
        setApplying(true); // disable the button / show the overlay before the long await
        const oldVersion = currentVersionRef.current;

        const { error } = await applyUpdate();
        if (error) {
            applyingRef.current = false;
            setApplying(false);
            return error;
        }

        // 202 accepted: the server verified + swapped the binary and is now
        // restarting. Wait for the new process to answer with a different
        // version, then reload to pick up the freshly embedded SPA. The api
        // middleware turns connection-refused during the drain into a normal
        // error result (not a throw), so getSystemVersion never rejects.
        await pollUntil(
            async () => {
                const v = (await getSystemVersion()).data?.version ?? null;
                return !!v && v !== oldVersion;
            },
            { interval: RESTART_POLL_INTERVAL, timeout: RESTART_POLL_TIMEOUT },
        );
        // Reload on success or timeout alike — best effort to land on the new SPA.
        window.location.reload();
        return null;
    }, []);

    const value = useMemo<UpdateContextValue>(
        () => ({
            status,
            systemVersion,
            loading,
            checking,
            applying,
            updateAvailable: status?.update_available ?? false,
            checkNow,
            apply,
        }),
        [status, systemVersion, loading, checking, applying, checkNow, apply],
    );

    return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}
