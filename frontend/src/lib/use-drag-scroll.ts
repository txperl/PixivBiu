import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";

// Pixels the pointer must travel before the gesture counts as a drag (pan) rather
// than a click. Below this, pointerup is left to fire a normal click (callers use
// it to exit a zoom layer); above it, the click is swallowed. Tuned so a steady
// click never reads as a drag.
const DRAG_THRESHOLD = 5;

// Turns any `overflow-auto` element into a click-and-drag panner. Returns a `ref`
// for the scroll container and `dragProps` to spread onto it. A gesture that moves
// past DRAG_THRESHOLD pans via scrollLeft/scrollTop and then swallows the synthetic
// click (onClickCapture) so a container onClick like "click exits zoom" doesn't
// fire after a drag; a sub-threshold press passes through as a normal click.
// Pointer-based, so it covers touch-drag too (pinch-zoom is out of scope).
export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
    const ref = useRef<T>(null);
    // Live gesture bookkeeping. `moved` latches once we cross the threshold and is
    // read by onClickCapture on the SAME gesture, then reset on the next pointerdown.
    const state = useRef({ active: false, moved: false, startX: 0, startY: 0, scrollX: 0, scrollY: 0 });

    const onPointerDown = useCallback((e: ReactPointerEvent<T>) => {
        // Primary button only; let right/middle-click behave normally.
        if (e.button !== 0) return;
        const el = ref.current;
        if (!el) return;
        state.current = {
            active: true,
            moved: false,
            startX: e.clientX,
            startY: e.clientY,
            scrollX: el.scrollLeft,
            scrollY: el.scrollTop,
        };
        // Capture so we keep getting move/up even if the pointer leaves the element
        // (fast drag past an edge). Released in endGesture.
        el.setPointerCapture(e.pointerId);
    }, []);

    const onPointerMove = useCallback((e: ReactPointerEvent<T>) => {
        const s = state.current;
        const el = ref.current;
        if (!s.active || !el) return;
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (!s.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        s.moved = true;
        // "Grab the canvas": drag right reveals content to the left.
        el.scrollLeft = s.scrollX - dx;
        el.scrollTop = s.scrollY - dy;
    }, []);

    const endGesture = useCallback((e: ReactPointerEvent<T>) => {
        const el = ref.current;
        if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        state.current.active = false;
        // Leave `moved` set — onClickCapture (fires after pointerup) reads it.
    }, []);

    // Runs before the container's onClick. If this gesture panned, stop the click so
    // a "click exits" handler never sees it. Then clear the latch for the next press.
    const onClickCapture = useCallback((e: ReactMouseEvent<T>) => {
        if (state.current.moved) {
            e.preventDefault();
            e.stopPropagation();
        }
        state.current.moved = false;
    }, []);

    return {
        ref,
        dragProps: {
            onPointerDown,
            onPointerMove,
            onPointerUp: endGesture,
            onPointerCancel: endGesture,
            onClickCapture,
        },
    };
}
