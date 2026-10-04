import { describe, expect, test } from "bun:test";
import { estimateCardHeight } from "../src/features/search/components/illust-grid-layout";

describe("illust grid layout", () => {
    test("unknown or hidden widths give no estimate", () => {
        expect(estimateCardHeight(0)).toBeNull();
        expect(estimateCardHeight(-1)).toBeNull();
        expect(estimateCardHeight(Number.NaN)).toBeNull();
    });

    test("matches auto-fill columns at the 200px minimum", () => {
        // One column until two 200px columns and a gap fit.
        expect(estimateCardHeight(150)).toBe(214);
        expect(estimateCardHeight(411)).toBe(475);
        expect(estimateCardHeight(412)).toBe(264);
        // Measured in the desktop app: 1154px grid, five 221px columns, 285px cards.
        expect(estimateCardHeight(1154)).toBe(285);
    });
});
