// Numbered pagination over Pixiv's continuation-only lists. Pixiv never reports a total, so
// the pager may only offer pages the server has confirmed exist: a page is known once an
// earlier page returned a continuation (`next_offset` / `next_max_bookmark_id`) pointing at it.
// The `Frontier` is what has been learned about one list so far; each fetched page adds an
// observation, and the pager renders from the result instead of guessing ahead.

// What one fetched page says about the list: it continues, it is the last page, or it is
// empty with no continuation (the list ended before this page — a stale deep link, a
// continuation that pointed at nothing, or a count hint that overshot).
export type PageOutcome = "more" | "last" | "empty";

export type PageObservation = {
    page: number;
    outcome: PageOutcome;
    // Cursor-paged lists only: the cursor that fetches page + 1.
    nextCursor?: number;
};

export type Frontier = {
    // Highest page confirmed to exist.
    knownMax: number;
    // The list ends at or before this page. Equal to knownMax once the end has been seen.
    ceiling?: number;
    // Cursor-paged lists: page → cursor that fetches it. Page 1 needs no cursor.
    cursors?: Record<number, number>;
};

export const INITIAL_FRONTIER: Frontier = { knownMax: 1 };

export function pageOutcome(hasNext: boolean, count: number): PageOutcome {
    if (hasNext) return "more";
    return count > 0 ? "last" : "empty";
}

function truncate(f: Frontier, knownMax: number, ceiling: number): Frontier {
    const cursors = f.cursors
        ? Object.fromEntries(Object.entries(f.cursors).filter(([p]) => Number(p) <= knownMax))
        : undefined;
    return { knownMax, ceiling, cursors };
}

export function advanceFrontier(f: Frontier, obs: PageObservation): Frontier {
    const { page, outcome } = obs;
    switch (outcome) {
        case "more": {
            const next = page + 1;
            const cursors = obs.nextCursor != null ? { ...f.cursors, [next]: obs.nextCursor } : f.cursors;
            // A page at or past the old ceiling continues: the list grew, so the bound is stale.
            const ceiling = f.ceiling != null && f.ceiling <= page ? undefined : f.ceiling;
            return { knownMax: Math.max(f.knownMax, next), ceiling, cursors };
        }
        case "last":
            return truncate(f, page, page);
        case "empty": {
            // Only an upper bound: the pages below were not necessarily seen.
            const end = Math.max(1, page - 1);
            return truncate(f, Math.min(f.knownMax, end), Math.min(f.ceiling ?? end, end));
        }
    }
}

// Highest page whose cursor is known — where a walk toward a deeper page resumes from.
export function cursorFrontier(f: Frontier): number {
    let max = 1;
    for (const p of Object.keys(f.cursors ?? {})) max = Math.max(max, Number(p));
    return max;
}

export type PagerState = {
    current: number;
    knownMax: number;
    // The real last page, once the list's end has been observed.
    lastPage?: number;
    // An estimate from an out-of-band count (e.g. a profile total). Shown, never trusted.
    lastPageHint?: number;
};

// `observed` is the current page's fresh result, folded in at render so the pager is right
// on the first frame instead of after the effect that persists it.
export function pagerStateOf(f: Frontier, current: number, observed?: PageObservation, hint?: number): PagerState {
    const merged = observed ? advanceFrontier(f, observed) : f;
    const { knownMax, ceiling } = merged;
    const lastPage = ceiling != null && ceiling <= knownMax ? knownMax : undefined;
    const capped = hint != null && lastPage == null ? Math.min(hint, ceiling ?? hint) : undefined;
    return { current, knownMax, lastPage, lastPageHint: capped != null && capped > knownMax ? capped : undefined };
}

// Highest page the pager offers. The current page is deliberately not counted: past the end
// (an empty deep link) it isn't a real page, and otherwise it is already within knownMax.
export function pagerUpper(s: PagerState): number {
    return s.lastPage ?? Math.max(s.knownMax, s.lastPageHint ?? 0);
}

export type PageItem = { kind: "page"; page: number } | { kind: "ellipsis"; key: string };

const WINDOW = 2;

// First page, a window around the current one, and the highest known (or hinted) page,
// with an ellipsis for each gap. A one-page gap shows the page instead of an ellipsis.
export function buildPageItems(s: PagerState): PageItem[] {
    const upper = pagerUpper(s);
    const anchors = new Set<number>([1, upper]);
    for (let p = s.current - WINDOW; p <= s.current + WINDOW; p++) anchors.add(p);
    const pages = [...anchors].filter((p) => p >= 1 && p <= upper).sort((a, b) => a - b);
    const out: PageItem[] = [];
    for (let i = 0; i < pages.length; i++) {
        const gap = i > 0 ? pages[i] - pages[i - 1] : 1;
        if (gap === 2) out.push({ kind: "page", page: pages[i] - 1 });
        else if (gap > 2) out.push({ kind: "ellipsis", key: `gap-${pages[i - 1]}-${pages[i]}` });
        out.push({ kind: "page", page: pages[i] });
    }
    return out;
}
