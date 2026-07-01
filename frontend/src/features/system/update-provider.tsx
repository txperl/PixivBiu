import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DesktopUpdateStatus, desktopBridge, isDesktop } from "@/lib/desktop";
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

// Synthetic error surfaced when a desktop bridge call rejects, so the UI shows a
// failure instead of a false success. The SPA localizes internal_error (mirrors
// lib/api/client.ts's SYNTHETIC).
const DESKTOP_BRIDGE_ERROR: UpdateApiError = { code: "internal_error", kind: "internal", message: "" };

// buildDesktopStatus maps an electron-updater event onto the same UpdateStatus
// shape the backend serves, so every UI consumer (sidebar dot, About panel,
// release-notes dialog) works unchanged in the desktop build. Only the terminal
// success states carry a status; "checking"/"downloading"/"error" return null —
// they drive the flags (or, for a failed manual check, the returned error) so a
// failure never stamps a misleading "up to date · last checked now", matching
// the web path (which doesn't adopt status on a failed check).
function buildDesktopStatus(s: DesktopUpdateStatus, currentVersion: string): UpdateStatus | null {
    const now = new Date().toISOString();
    const base = { current_version: currentVersion, is_dev: false } as UpdateStatus;
    switch (s.state) {
        case "available":
        case "downloaded":
            return {
                ...base,
                update_available: true,
                latest_version: s.version,
                release_notes: s.notes,
                last_checked: now,
            };
        case "not-available":
            return { ...base, update_available: false, latest_version: currentVersion, last_checked: now };
        default:
            return null;
    }
}

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
    // In the desktop build, electron-updater owns updates (the core's own
    // self-updater is disabled via env). We feed the same context off the
    // Electron bridge instead of the /system/update* endpoints.
    const desktop = isDesktop();
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

    // Initial load: build info always (open, no auth). On the web we also adopt
    // the backend's cached update status; in desktop the bridge drives status,
    // so we only need build info here.
    useEffect(() => {
        let alive = true;
        void (async () => {
            const ver = await getSystemVersion();
            if (alive && ver.data) setSystemVersion(ver.data);
            if (!desktop) {
                const st = await getUpdateStatus();
                if (alive && st.data) adoptStatus(st.data);
            }
            if (alive) setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, [adoptStatus, desktop]);

    // Slow steady-state refresh (web only — desktop status is push-based).
    useEffect(() => {
        if (desktop) return;
        const id = setInterval(() => void refresh(), SLOW_POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [refresh, desktop]);

    // Fast catch-up until the backend's first check lands. Check() stamps
    // last_checked even when it fails, so this stops as soon as the backend has
    // checked once; the attempt cap is the backstop for the disabled case where
    // last_checked never appears.
    const checkedOnce = !!status?.last_checked;
    useEffect(() => {
        if (desktop || checkedOnce) return;
        let n = 0;
        const id = setInterval(() => {
            void refresh();
            if (++n >= FAST_POLL_MAX_ATTEMPTS) clearInterval(id);
        }, FAST_POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [refresh, checkedOnce, desktop]);

    // apply / the desktop subscription read the current version at call time;
    // keep it in a ref so the callbacks stay stable and never churn the context.
    const currentVersionRef = useRef("");
    currentVersionRef.current = status?.current_version ?? systemVersion?.version ?? "";

    // Desktop: subscribe to electron-updater events, map them onto UpdateStatus,
    // and kick off an initial check. checking/downloading toggle the flags;
    // terminal events adopt a synthesized status.
    useEffect(() => {
        if (!desktop) return;
        const bridge = desktopBridge();
        const unsub = bridge.updates.onStatus((s) => {
            if (s.state === "checking") {
                setChecking(true);
                return;
            }
            if (s.state === "downloading") {
                setApplying(true);
                return;
            }
            setChecking(false);
            const built = buildDesktopStatus(s, currentVersionRef.current);
            if (built) adoptStatus(built);
            if (s.state === "downloaded") setApplying(true);
        });
        void bridge.updates.check();
        return unsub;
    }, [desktop, adoptStatus]);

    const checkNow = useCallback(async (): Promise<UpdateApiError | null> => {
        if (desktop) {
            setChecking(true);
            try {
                await desktopBridge().updates.check();
                return null; // result arrives via the subscription; it clears `checking`
            } catch {
                setChecking(false); // a failed check must surface, not read as "up to date"
                return DESKTOP_BRIDGE_ERROR;
            }
        }
        setChecking(true);
        try {
            const { data, error } = await checkForUpdate();
            if (data) adoptStatus(data);
            return error;
        } finally {
            setChecking(false);
        }
    }, [adoptStatus, desktop]);

    // applyingRef gates re-entry synchronously: a real apply spends a long time
    // downloading/verifying/swapping the binary before applyUpdate() resolves,
    // and `applying` state alone updates a render later — so a rapid double-click
    // could otherwise fire concurrent POST /system/update/apply requests.
    const applyingRef = useRef(false);

    const apply = useCallback(async (): Promise<UpdateApiError | null> => {
        if (applyingRef.current) return null;
        applyingRef.current = true;
        setApplying(true); // disable the button / show the overlay before the long await

        // Desktop: hand off to electron-updater. It downloads, then quits and
        // relaunches the whole app into the new version — no SPA reload dance.
        if (desktop) {
            try {
                await desktopBridge().updates.downloadAndInstall();
            } catch {
                applyingRef.current = false;
                setApplying(false);
                return DESKTOP_BRIDGE_ERROR; // surface the failure instead of a silent "success"
            }
            return null;
        }

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
    }, [desktop]);

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
