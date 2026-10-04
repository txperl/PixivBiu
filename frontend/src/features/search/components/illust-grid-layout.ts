// Geometry of the shared artwork grid: `repeat(auto-fill, minmax(200px, 1fr))`
// columns with a 12px gap. A card is a square image inside 8px padding plus an
// 80px text block, so its height follows from the column width alone.
export const ILLUST_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3";

const MIN_COLUMN = 200;
const GAP = 12;
const CARD_PADDING = 16;
const CARD_TEXT = 80;

// Estimated card height for a grid of the given width, used as the intrinsic size
// of cards that content-visibility skips before they first render. Null when the
// width is unknown (a hidden kept-alive page measures 0).
export function estimateCardHeight(gridWidth: number): number | null {
    if (!(gridWidth > 0)) return null;
    const columns = Math.max(1, Math.floor((gridWidth + GAP) / (MIN_COLUMN + GAP)));
    const cardWidth = (gridWidth - GAP * (columns - 1)) / columns;
    return Math.round(cardWidth - CARD_PADDING + CARD_TEXT);
}
