import { describe, expect, mock, test } from "bun:test";
import { observeImageReadiness } from "../src/lib/image-readiness";

class TestImage extends EventTarget {
    src = "https://example.test/a.png";
    complete = false;
    naturalWidth = 0;
    pending = Promise.withResolvers<void>();
    decode = mock(() => this.pending.promise);
    loaded() {
        this.complete = true;
        this.naturalWidth = 100;
        this.dispatchEvent(new Event("load"));
    }
}
function observe(img: TestImage) {
    const callbacks = { onLoad: mock(), onReady: mock(), onError: mock() };
    const cleanup = observeImageReadiness(img as unknown as HTMLImageElement, callbacks);
    return { ...callbacks, cleanup };
}
const flush = async () => {
    await Promise.resolve();
};

describe("decoded image readiness", () => {
    test("lazy images are not decoded before load, and load is not readiness", async () => {
        const img = new TestImage();
        const callbacks = observe(img);
        expect(img.decode).not.toHaveBeenCalled();
        img.loaded();
        expect(callbacks.onLoad).toHaveBeenCalledTimes(1);
        expect(callbacks.onReady).not.toHaveBeenCalled();
        img.pending.resolve();
        await flush();
        expect(callbacks.onReady).toHaveBeenCalledTimes(1);
        callbacks.cleanup();
    });

    test("cached completion and a later load event decode and notify only once", async () => {
        const img = new TestImage();
        img.loaded();
        const callbacks = observe(img);
        img.loaded();
        expect(img.decode).toHaveBeenCalledTimes(1);
        img.pending.resolve();
        await flush();
        expect(callbacks.onLoad).toHaveBeenCalledTimes(1);
        expect(callbacks.onReady).toHaveBeenCalledTimes(1);
        callbacks.cleanup();
    });

    test("decode rejection reports failure, never readiness", async () => {
        const img = new TestImage();
        const callbacks = observe(img);
        img.loaded();
        img.pending.reject(new Error("corrupt image"));
        await flush();
        img.dispatchEvent(new Event("error"));
        expect(callbacks.onError).toHaveBeenCalledTimes(1);
        expect(callbacks.onReady).not.toHaveBeenCalled();
        callbacks.cleanup();
    });

    test("load failures and already-complete broken images are reported", () => {
        for (const cached of [false, true]) {
            const img = new TestImage();
            img.complete = cached;
            const callbacks = observe(img);
            img.dispatchEvent(new Event("error"));
            expect(callbacks.onError).toHaveBeenCalledTimes(1);
            expect(img.decode).not.toHaveBeenCalled();
            callbacks.cleanup();
        }
    });

    test("closing or changing source revokes late decode results", async () => {
        for (const revoke of ["cleanup", "source"] as const) {
            const img = new TestImage();
            const callbacks = observe(img);
            img.loaded();
            if (revoke === "cleanup") callbacks.cleanup();
            else img.src = "https://example.test/b.png";
            img.pending.resolve();
            await flush();
            expect(callbacks.onReady).not.toHaveBeenCalled();
            expect(callbacks.onError).not.toHaveBeenCalled();
            callbacks.cleanup();
        }
    });

    test("hiding mid-decode revokes the old subscription; reveal rechecks the cached image", async () => {
        const img = new TestImage();
        const hidden = observe(img);
        img.loaded();
        hidden.cleanup();
        const shown = observe(img);
        img.pending.resolve();
        await flush();
        expect(hidden.onReady).not.toHaveBeenCalled();
        expect(shown.onReady).toHaveBeenCalledTimes(1);
        shown.cleanup();
    });

    test("a late decode rejection after cleanup is ignored", async () => {
        const img = new TestImage();
        const callbacks = observe(img);
        img.loaded();
        callbacks.cleanup();
        img.pending.reject(new Error("detached image"));
        await flush();
        expect(callbacks.onError).not.toHaveBeenCalled();
        expect(callbacks.onReady).not.toHaveBeenCalled();
    });

    test("a decoded result without usable dimensions is still a failure", async () => {
        const img = new TestImage();
        const callbacks = observe(img);
        img.loaded();
        img.naturalWidth = 0;
        img.pending.resolve();
        await flush();
        expect(callbacks.onError).toHaveBeenCalledTimes(1);
        expect(callbacks.onReady).not.toHaveBeenCalled();
        callbacks.cleanup();
    });
});
