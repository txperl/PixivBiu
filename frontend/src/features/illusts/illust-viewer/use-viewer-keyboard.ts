import { type RefObject, useLayoutEffect } from "react";
import { clampViewerPage, ownsViewerKeyboard, type ViewerNavigationState, viewerKeyStep } from "./viewer-navigation";

export type ViewerKeyboardScope = {
    open: boolean;
    dialogRef: RefObject<HTMLDivElement | null>;
    keyDownRef: RefObject<((event: KeyboardEvent) => void) | null>;
};

export function useViewerKeyboard({
    dialogRef,
    keyDownRef,
    open,
    zoomed,
    total,
    active,
    step,
}: ViewerKeyboardScope & ViewerNavigationState & { active: number; step: (delta: -1 | 1) => void }) {
    // Base UI stops arrow-key propagation at Dialog.Popup. Register at that
    // React bubbling boundary after child controls, rather than on window.
    // Layout cleanup disables the committed handler before paint on close,
    // zoom or Activity hide, even while closing content remains mounted.
    useLayoutEffect(() => {
        if (!open || zoomed || total <= 1) return;
        const onKeyDown = (event: KeyboardEvent) => {
            const delta = viewerKeyStep(event, { open, zoomed, total });
            const root = dialogRef.current;
            if (delta === null || !root || !ownsViewerKeyboard(root, event.target, root.ownerDocument.activeElement))
                return;
            if (clampViewerPage(active + delta, total) === active) return;
            event.preventDefault();
            step(delta);
        };
        keyDownRef.current = onKeyDown;
        return () => {
            if (keyDownRef.current === onKeyDown) keyDownRef.current = null;
        };
    }, [open, zoomed, total, active, dialogRef, keyDownRef, step]);
}
