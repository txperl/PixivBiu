import { describe, expect, test } from "bun:test";
import {
    buildDesktopStatus,
    observeDesktopUpdates,
    readRestartPrompt,
    supportsTwoPhaseUpdates,
} from "../src/features/system/desktop-update-state";
import type { DesktopBridge, DesktopUpdateSnapshot, DesktopUpdateStatus } from "../src/lib/desktop";

const snapshot = (sequence: number, patch: Partial<DesktopUpdateSnapshot> = {}): DesktopUpdateSnapshot => ({
    sequence,
    currentVersion: "1.0.0",
    format: "nsis",
    installMode: "in-app",
    state: "available",
    version: "1.1.0",
    ...patch,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fixture(modern = true) {
    let emit: (status: DesktopUpdateStatus) => void = () => {};
    let finishRead: (status: DesktopUpdateSnapshot) => void = () => {};
    const calls: string[] = [];
    const received: DesktopUpdateStatus[] = [];
    const bridge = {
        updates: {
            check: async () => {
                calls.push("check");
            },
            downloadAndInstall: async () => {},
            onStatus: (callback: (status: DesktopUpdateStatus) => void) => {
                calls.push("subscribe");
                emit = callback;
                return () => {
                    calls.push("unsubscribe");
                };
            },
            ...(modern
                ? {
                      read: () => {
                          calls.push("read");
                          return new Promise<DesktopUpdateSnapshot>((resolve) => {
                              finishRead = resolve;
                          });
                      },
                      download: async () => {},
                      restartAndInstall: async () => {},
                  }
                : {}),
        },
    } as DesktopBridge;
    const stop = observeDesktopUpdates(
        bridge,
        (status) => received.push(status),
        () => {
            calls.push("failed");
        },
    );
    return {
        bridge,
        calls,
        received,
        stop,
        emit: (status: DesktopUpdateStatus) => emit(status),
        finishRead: (status: DesktopUpdateSnapshot) => finishRead(status),
    };
}

describe("desktop update snapshots", () => {
    test("subscribe before read, then ignore delayed reads and out-of-order events", async () => {
        const f = fixture();
        expect(f.calls).toEqual(["subscribe", "read"]);
        f.emit(snapshot(5, { state: "downloaded", readyToInstall: true }));
        f.finishRead(snapshot(3));
        await tick();
        f.emit(snapshot(4));
        f.emit(snapshot(5));
        f.emit(snapshot(6, { state: "preparing-install" }));
        expect(f.received.map((status) => ("sequence" in status ? status.sequence : -1))).toEqual([5, 6]);
        expect(f.calls).not.toContain("check");
        f.stop();
    });

    test("navigation cleanup ignores both late events and the initial read", async () => {
        const f = fixture();
        f.stop();
        f.emit(snapshot(7));
        f.finishRead(snapshot(8));
        await tick();
        expect(f.received).toEqual([]);
        expect(f.calls).toContain("unsubscribe");
    });

    test("older shells subscribe then check and keep their original bridge compatible", () => {
        const f = fixture(false);
        expect(supportsTwoPhaseUpdates(f.bridge)).toBe(false);
        expect(f.calls).toEqual(["subscribe", "check"]);
        f.emit({ state: "available", version: "1.1.0", notes: "Notes" });
        expect(buildDesktopStatus(f.received[0], "1.0.0")?.latest_version).toBe("1.1.0");
        f.stop();
    });

    test("progress and errors retain Desktop version and offer without inventing a successful check", () => {
        const status = buildDesktopStatus(
            snapshot(9, { state: "error", error: "download_failed", notes: "Notes" }),
            "3.9.0-core",
        );
        expect(status?.current_version).toBe("1.0.0");
        expect(status?.latest_version).toBe("1.1.0");
        expect(status?.release_notes).toBe("Notes");
        expect(status?.last_checked).toBeUndefined();
        expect(buildDesktopStatus(snapshot(10, { installMode: "disabled" }), "core")?.is_dev).toBe(true);
        expect(
            buildDesktopStatus(snapshot(11, { format: "deb", installMode: "external" }), "core")?.update_available,
        ).toBe(true);
    });

    test("a failed initial read produces a recoverable bridge error", async () => {
        const f = fixture();
        f.stop();
        f.bridge.updates.read = async () => {
            throw new Error("fixture IPC failure");
        };
        const stop = observeDesktopUpdates(
            f.bridge,
            () => {},
            () => f.calls.push("failed"),
        );
        await tick();
        expect(f.calls).toContain("failed");
        stop();
    });
});

describe("fresh download-task confirmation", () => {
    test("empty queues allow restart and active queues require the current count", async () => {
        expect(await readRestartPrompt(async () => ({ data: { active_count: 0 }, error: null }))).toBeUndefined();
        expect(await readRestartPrompt(async () => ({ data: { active_count: 7 }, error: null }))).toBe(7);
    });

    test("network, auth and malformed responses require explicit unknown-status consent", async () => {
        for (const result of [
            { data: null, error: null },
            { data: { active_count: 0 }, error: {} },
            { data: { active_count: -1 }, error: null },
            { data: { active_count: Number.NaN }, error: null },
        ]) {
            expect(await readRestartPrompt(async () => result)).toBeNull();
        }
        expect(
            await readRestartPrompt(async () => {
                throw new Error("offline");
            }),
        ).toBeNull();
    });
});
