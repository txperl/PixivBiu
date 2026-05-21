import { animate, createSpring } from "animejs";
import { useCallback } from "react";

// CSS-based entrance fades ran at inconsistent durations between cold reload
// and HMR; animejs + rAF is stable. The ref callback also hides the element
// before paint so consumers don't need inline `opacity: 0` everywhere.
export function useReveal<T extends HTMLElement = HTMLElement>(delay = 0) {
    return useCallback(
        (el: T | null) => {
            if (!el) return;
            el.style.opacity = "0";
            const anim = animate(el, {
                opacity: { from: 0, to: 1, ease: createSpring({ stiffness: 100, damping: 20, mass: 1 }) },
                translateY: { from: "6px", to: "0px", ease: createSpring({ stiffness: 90, damping: 18, mass: 1 }) },
                delay,
            });
            return () => {
                anim.cancel();
            };
        },
        [delay],
    );
}
