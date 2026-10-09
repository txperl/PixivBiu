import type { DesktopBridge, DesktopUpdateSnapshot, DesktopUpdateStatus } from "@/lib/desktop";
import type { UpdateStatus } from "./api";

export function supportsTwoPhaseUpdates(bridge: DesktopBridge): boolean {
    return (
        typeof bridge.updates.read === "function" &&
        typeof bridge.updates.download === "function" &&
        typeof bridge.updates.restartAndInstall === "function"
    );
}

export function isUpdateSnapshot(status: DesktopUpdateStatus): status is DesktopUpdateSnapshot {
    return "sequence" in status;
}

// undefined means no warning is needed; null means status could not be checked.
export async function readRestartPrompt(
    read: () => Promise<{ data: { active_count: number } | null; error: unknown }>,
): Promise<number | null | undefined> {
    try {
        const { data, error } = await read();
        if (error || !data || !Number.isSafeInteger(data.active_count) || data.active_count < 0) return null;
        return data.active_count > 0 ? data.active_count : undefined;
    } catch {
        return null;
    }
}

// Subscribe before reading so a delayed snapshot cannot overwrite a newer event.
export function observeDesktopUpdates(
    bridge: DesktopBridge,
    receive: (status: DesktopUpdateStatus) => void,
    failed: () => void,
): () => void {
    let alive = true;
    let sequence = -1;
    const deliver = (status: DesktopUpdateStatus) => {
        if (!alive) return;
        if (isUpdateSnapshot(status)) {
            if (status.sequence <= sequence) return;
            sequence = status.sequence;
        }
        receive(status);
    };
    const unsubscribe = bridge.updates.onStatus(deliver);
    const initial = supportsTwoPhaseUpdates(bridge) ? bridge.updates.read?.().then(deliver) : bridge.updates.check();
    void initial?.catch(() => {
        if (alive && sequence < 0) failed();
    });
    return () => {
        alive = false;
        unsubscribe();
    };
}

export function buildDesktopStatus(status: DesktopUpdateStatus, legacyVersion: string): UpdateStatus | null {
    if (isUpdateSnapshot(status)) {
        // Progress/errors carry the last successful offer without fabricating a check.
        return {
            current_version: status.currentVersion,
            is_dev: status.installMode === "disabled",
            update_available: !!status.version,
            latest_version: status.version ?? status.currentVersion,
            release_notes: status.notes,
            release_url: status.releaseUrl,
            published_at: status.publishedAt,
            last_checked: status.lastChecked,
        };
    }
    const base = { current_version: legacyVersion, is_dev: false };
    if (status.state === "available" || status.state === "downloaded") {
        return {
            ...base,
            update_available: true,
            latest_version: status.version,
            release_notes: status.notes,
            last_checked: new Date().toISOString(),
        };
    }
    return status.state === "not-available"
        ? { ...base, update_available: false, latest_version: legacyVersion, last_checked: new Date().toISOString() }
        : null;
}
