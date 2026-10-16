import { describe, expect, test } from "bun:test";
import { clampViewerPage, viewerKeyStep } from "../src/features/illusts/illust-viewer/viewer-navigation";

const state = { open: true, zoomed: false, total: 3 };
const key = {
    key: "ArrowRight",
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
};

describe("viewer keyboard navigation", () => {
    test("only bare horizontal arrows step within an open multi-page work", () => {
        expect(viewerKeyStep(key, state)).toBe(1);
        expect(viewerKeyStep({ ...key, key: "ArrowLeft" }, state)).toBe(-1);
        for (const other of ["ArrowUp", "ArrowDown", "Tab", "Enter", " ", "Escape", "Home", "End"])
            expect(viewerKeyStep({ ...key, key: other }, state)).toBeNull();
    });

    test("controls, IME, modifiers and key repeat retain ownership", () => {
        for (const flag of [
            "defaultPrevented",
            "isComposing",
            "repeat",
            "altKey",
            "ctrlKey",
            "metaKey",
            "shiftKey",
        ] as const)
            expect(viewerKeyStep({ ...key, [flag]: true }, state)).toBeNull();
    });

    test("closing, zoom and a single or empty page list disable shortcuts", () => {
        for (const change of [{ open: false }, { zoomed: true }, { total: 1 }, { total: 0 }])
            expect(viewerKeyStep(key, { ...state, ...change })).toBeNull();
    });

    test("ordered steps stop at either boundary without wrapping", () => {
        let page = 0;
        const visited = [1, 1, 1, -1, -1, -1].map((delta) => {
            page = clampViewerPage(page + delta, 3);
            return page;
        });
        expect(visited).toEqual([1, 2, 2, 1, 0, 0]);
    });

    test("a refreshed shorter list clamps the current page before source lookup", () => {
        expect(clampViewerPage(9, 3)).toBe(2);
        expect(clampViewerPage(2, 1)).toBe(0);
        expect(clampViewerPage(-1, 3)).toBe(0);
        expect(clampViewerPage(0, 0)).toBe(0);
    });
});
