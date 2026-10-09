import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIVE_STATUSES } from "@/features/downloads";
import { listDownloads } from "@/features/downloads/api";
import { type DesktopUpdateErrorCode, type DesktopUpdateSnapshot, desktopBridge, isDesktop } from "@/lib/desktop";
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
import { DesktopUpdateOverlays } from "./desktop-update-overlays";
import {
    buildDesktopStatus,
    isUpdateSnapshot,
    observeDesktopUpdates,
    readRestartPrompt,
    supportsTwoPhaseUpdates,
} from "./desktop-update-state";
import { UpdateContext, type UpdateContextValue } from "./update-context";

const DESKTOP_BRIDGE_ERROR: UpdateApiError = { code: "internal_error", kind: "internal", message: "" };
const SLOW_POLL_INTERVAL_MS = 30 * 60_000;
const FAST_POLL_INTERVAL_MS = 5_000;
const FAST_POLL_MAX_ATTEMPTS = 24;
const RESTART_POLL_INTERVAL = 1500;
const RESTART_POLL_TIMEOUT = 120_000;

export function UpdateProvider({ children }: { children: ReactNode }) {
    const desktop = isDesktop();
    const twoPhaseUpdates = desktop && supportsTwoPhaseUpdates(desktopBridge());
    const [status, setStatus] = useState<UpdateStatus | null>(null);
    const [systemVersion, setSystemVersion] = useState<SystemVersion | null>(null);
    const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateSnapshot | null>(null);
    const desktopRef = useRef<DesktopUpdateSnapshot | null>(null);
    const [localDesktopError, setLocalDesktopError] = useState<DesktopUpdateErrorCode | null>(null);
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [applying, setApplying] = useState(false);
    const [actionPending, setActionPending] = useState(false);
    const [restartPrompt, setRestartPrompt] = useState<number | null | undefined>(undefined);
    const promptRef = useRef(false);
    const applyingRef = useRef(false);
    const currentVersionRef = useRef("");
    currentVersionRef.current = status?.current_version ?? systemVersion?.version ?? "";

    const adoptStatus = useCallback((next: UpdateStatus) => {
        setStatus((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }, []);
    const refresh = useCallback(async () => {
        const { data } = await getUpdateStatus();
        if (data) adoptStatus(data);
    }, [adoptStatus]);

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

    useEffect(() => {
        if (desktop) return;
        const id = setInterval(() => void refresh(), SLOW_POLL_INTERVAL_MS);
        return () => clearInterval(id);
    }, [refresh, desktop]);

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

    useEffect(() => {
        if (!desktop) return;
        return observeDesktopUpdates(
            desktopBridge(),
            (snapshot) => {
                if (isUpdateSnapshot(snapshot)) {
                    desktopRef.current = snapshot;
                    setDesktopUpdate(snapshot);
                    setChecking(snapshot.state === "checking");
                    setApplying(snapshot.state === "preparing-install" || snapshot.state === "installing");
                    if (snapshot.state === "error") applyingRef.current = false;
                } else {
                    // Older shells still download and restart as one operation.
                    setChecking(snapshot.state === "checking");
                    if (snapshot.state === "downloading" || snapshot.state === "downloaded") setApplying(true);
                    if (snapshot.state === "error") {
                        applyingRef.current = false;
                        setApplying(false);
                    }
                }
                const built = buildDesktopStatus(snapshot, currentVersionRef.current);
                if (built) adoptStatus(built);
            },
            () => {
                setChecking(false);
                setLocalDesktopError("check_failed");
            },
        );
    }, [desktop, adoptStatus]);

    const checkNow = useCallback(async (): Promise<UpdateApiError | null> => {
        setChecking(true);
        setLocalDesktopError(null);
        try {
            if (desktop) {
                await desktopBridge().updates.check();
                return null;
            }
            const { data, error } = await checkForUpdate();
            if (data) adoptStatus(data);
            return error;
        } catch {
            if (twoPhaseUpdates) setLocalDesktopError("check_failed");
            return DESKTOP_BRIDGE_ERROR;
        } finally {
            setChecking(false);
        }
    }, [adoptStatus, desktop, twoPhaseUpdates]);

    const restart = useCallback(async (): Promise<UpdateApiError | null> => {
        if (applyingRef.current) return null;
        applyingRef.current = true;
        setActionPending(true);
        setLocalDesktopError(null);
        try {
            await desktopBridge().updates.restartAndInstall?.();
            return null;
        } catch {
            setApplying(false);
            setLocalDesktopError("install_failed");
            return DESKTOP_BRIDGE_ERROR;
        } finally {
            applyingRef.current = false;
            setActionPending(false);
        }
    }, []);

    const apply = useCallback(async (): Promise<UpdateApiError | null> => {
        if (applyingRef.current || promptRef.current) return null;
        if (twoPhaseUpdates) {
            const snapshot = desktopRef.current;
            if (!snapshot || snapshot.installMode !== "in-app") return DESKTOP_BRIDGE_ERROR;
            applyingRef.current = true;
            setActionPending(true);
            setLocalDesktopError(null);
            try {
                if (!snapshot.readyToInstall) {
                    await desktopBridge().updates.download?.();
                    return null;
                }
                // The global download cache can be stale after SSE loss: re-read
                // authoritative active_count immediately before restart consent.
                const warning = await readRestartPrompt(() =>
                    listDownloads({ status: [...ACTIVE_STATUSES], perPage: 1 }),
                );
                if (warning !== undefined) {
                    promptRef.current = true;
                    setRestartPrompt(warning);
                    return null;
                }
            } catch {
                setLocalDesktopError(snapshot.readyToInstall ? "install_failed" : "download_failed");
                return DESKTOP_BRIDGE_ERROR;
            } finally {
                applyingRef.current = false;
                setActionPending(false);
            }
            return restart();
        }

        applyingRef.current = true;
        setApplying(true);
        if (desktop) {
            try {
                await desktopBridge().updates.downloadAndInstall();
            } catch {
                applyingRef.current = false;
                setApplying(false);
                return DESKTOP_BRIDGE_ERROR;
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
        await pollUntil(
            async () => {
                const version = (await getSystemVersion()).data?.version ?? null;
                return !!version && version !== oldVersion;
            },
            { interval: RESTART_POLL_INTERVAL, timeout: RESTART_POLL_TIMEOUT },
        );
        window.location.reload();
        return null;
    }, [desktop, twoPhaseUpdates, restart]);

    const desktopError = desktopUpdate?.error ?? localDesktopError;
    const value = useMemo<UpdateContextValue>(
        () => ({
            status,
            systemVersion,
            loading,
            checking,
            applying,
            actionPending,
            twoPhaseUpdates,
            desktopUpdate,
            desktopError,
            updateAvailable: status?.update_available ?? false,
            checkNow,
            apply,
        }),
        [
            status,
            systemVersion,
            loading,
            checking,
            applying,
            actionPending,
            twoPhaseUpdates,
            desktopUpdate,
            desktopError,
            checkNow,
            apply,
        ],
    );

    const cancelRestart = () => {
        promptRef.current = false;
        setRestartPrompt(undefined);
    };
    return (
        <UpdateContext.Provider value={value}>
            {children}
            {twoPhaseUpdates && (
                <DesktopUpdateOverlays
                    applying={applying}
                    activeCount={restartPrompt}
                    cancel={cancelRestart}
                    confirm={() => {
                        cancelRestart();
                        void restart();
                    }}
                />
            )}
        </UpdateContext.Provider>
    );
}
