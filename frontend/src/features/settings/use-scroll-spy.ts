import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { HEADER_HEIGHT, SCROLL_OFFSET } from "./presentation";

// Sections are tagged with `data-section-id`; this finds them inside the
// scroll container so the hook stays decoupled from the markup.
function sectionEl(scroller: HTMLElement, id: string): HTMLElement | null {
    return scroller.querySelector<HTMLElement>(`[data-section-id="${id}"]`);
}

export interface UseScrollSpyResult {
    activeId: string | undefined;
    scrollTo: (id: string) => void;
}

// Highlights the section currently scrolled into view and smooth-scrolls to a
// section on demand. The scroll container is the page's `<main>`, not the
// window, so the observer is rooted there. A short suppression window stops
// the programmatic scroll from fighting the optimistic highlight.
export function useScrollSpy(scrollerRef: RefObject<HTMLElement | null>, ids: string[]): UseScrollSpyResult {
    const [activeId, setActiveId] = useState<string | undefined>(ids[0]);
    const programmaticRef = useRef(false);
    // Tears down the in-flight settle listener/timer from the previous
    // scrollTo, so a rapid second click doesn't leak the first one.
    const settleCleanupRef = useRef<(() => void) | null>(null);
    const idsKey = ids.join(",");

    useEffect(() => {
        const scroller = scrollerRef.current;
        const sectionIds = idsKey ? idsKey.split(",") : [];
        if (!scroller || sectionIds.length === 0) return;

        // id -> distance from the container's top; the topmost wins.
        const tops = new Map<string, number>();
        const observer = new IntersectionObserver(
            (entries) => {
                if (programmaticRef.current) return;
                for (const entry of entries) {
                    const id = entry.target.getAttribute("data-section-id");
                    if (!id) continue;
                    if (entry.isIntersecting) tops.set(id, entry.boundingClientRect.top);
                    else tops.delete(id);
                }
                let best: string | undefined;
                let bestTop = Number.POSITIVE_INFINITY;
                for (const [id, top] of tops) {
                    if (top < bestTop) {
                        bestTop = top;
                        best = id;
                    }
                }
                if (best) setActiveId(best);
            },
            // Inset the top by the fixed bar's height so the strip it occludes
            // doesn't count as "in view" and the wrong section never wins.
            { root: scroller, rootMargin: `-${HEADER_HEIGHT}px 0px -65% 0px`, threshold: 0 },
        );

        for (const id of sectionIds) {
            const el = sectionEl(scroller, id);
            if (el) observer.observe(el);
        }
        return () => observer.disconnect();
    }, [idsKey, scrollerRef]);

    const scrollTo = useCallback(
        (id: string) => {
            const scroller = scrollerRef.current;
            const el = scroller && sectionEl(scroller, id);
            if (!scroller || !el) return;

            settleCleanupRef.current?.();
            programmaticRef.current = true;
            setActiveId(id);

            const top =
                el.getBoundingClientRect().top -
                scroller.getBoundingClientRect().top +
                scroller.scrollTop -
                SCROLL_OFFSET;
            scroller.scrollTo({ top, behavior: "smooth" });

            // Release suppression once the smooth scroll settles (debounced).
            let timer: ReturnType<typeof setTimeout>;
            const onScroll = () => {
                clearTimeout(timer);
                timer = setTimeout(() => settleCleanupRef.current?.(), 150);
            };
            settleCleanupRef.current = () => {
                clearTimeout(timer);
                scroller.removeEventListener("scroll", onScroll);
                programmaticRef.current = false;
                settleCleanupRef.current = null;
            };
            scroller.addEventListener("scroll", onScroll);
            onScroll();
        },
        [scrollerRef],
    );

    // Drop any pending settle listener on unmount.
    useEffect(() => () => settleCleanupRef.current?.(), []);

    return { activeId, scrollTo };
}
