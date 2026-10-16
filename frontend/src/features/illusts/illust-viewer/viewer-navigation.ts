type NavigationKey = Pick<
    KeyboardEvent,
    "key" | "defaultPrevented" | "isComposing" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

export type ViewerNavigationState = { open: boolean; zoomed: boolean; total: number };

export function clampViewerPage(page: number, total: number): number {
    return Math.max(0, Math.min(total - 1, page));
}

export function viewerKeyStep(event: NavigationKey, { open, zoomed, total }: ViewerNavigationState): -1 | 1 | null {
    if (
        !open ||
        zoomed ||
        total <= 1 ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
    )
        return null;
    return event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
}

// These controls own arrow keys even when their current handler doesn't cancel
// the event (for example a slider already at its limit).
const ARROW_CONTROL = [
    "input",
    "textarea",
    "select",
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="combobox"]',
    '[role="spinbutton"]',
    '[role="slider"]',
    '[role="listbox"]',
    '[role="menu"]',
    '[role="menubar"]',
    '[role="tree"]',
    '[role="treegrid"]',
    '[role="grid"]',
    '[role="tablist"]',
    '[role="radiogroup"]',
    '[role="toolbar"]',
    '[data-slot="popover-content"]',
].join(",");

export function ownsViewerKeyboard(root: HTMLElement, target: EventTarget | null, focused: Element | null): boolean {
    if (
        !root.hasAttribute("data-open") ||
        root.hasAttribute("data-closed") ||
        root.hasAttribute("data-nested-dialog-open") ||
        root.querySelector('[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]')
    )
        return false;

    return [target, focused].every(
        (element) =>
            element instanceof HTMLElement &&
            root.contains(element) &&
            element.closest('[role="dialog"], [role="alertdialog"]') === root &&
            !element.isContentEditable &&
            !element.closest(ARROW_CONTROL),
    );
}
