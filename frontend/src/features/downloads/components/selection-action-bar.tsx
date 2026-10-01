import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { CloseIcon, DownloadIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useSelectionContext } from "../selection-context";
import type { IllustSelectionStore } from "../selection-state";

function ActiveSelectionActionBar({ store }: { store: IllustSelectionStore }) {
    const m = useMessages();
    const { download } = useSelectionContext();
    const { mode, selected, visibleIds, scope, pending, result } = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
    );
    const root = useRef<HTMLDivElement>(null);
    const focusWithin = useRef(false);
    const visible = mode || (result !== null && Date.now() - result.finishedAt < 3000);
    const hasSelection = selected.size > 0;

    useEffect(() => {
        if (mode || !result) return;
        const timer = setTimeout(store.dismissResult, Math.max(0, 3000 - (Date.now() - result.finishedAt)));
        return () => clearTimeout(timer);
    }, [mode, result, store]);

    useLayoutEffect(() => {
        if (!mode && result && focusWithin.current) {
            store.restoreFocus?.();
            focusWithin.current = false;
        }
    }, [mode, result, store]);

    useLayoutEffect(() => {
        const element = root.current;
        const main = element?.closest("main");
        if (!element || !main || !visible) return;
        const measure = () =>
            main.style.setProperty(
                "--selection-bar-space",
                `${Math.ceil(element.getBoundingClientRect().height) + 32}px`,
            );
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => {
            observer.disconnect();
            main.style.removeProperty("--selection-bar-space");
        };
    }, [visible]);

    useEffect(() => {
        if (!mode) return;
        const onEscape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
            const target = event.target;
            if (
                target instanceof Element &&
                target.closest(
                    "input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]",
                )
            )
                return;
            if (
                document.querySelector(
                    '[role="dialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]',
                )
            )
                return;
            event.preventDefault();
            store.exit();
            store.restoreFocus?.();
        };
        window.addEventListener("keydown", onEscape);
        return () => window.removeEventListener("keydown", onEscape);
    }, [mode, store]);

    if (!visible) return null;
    const exit = () => {
        store.exit();
        store.restoreFocus?.();
    };
    const resultText = result
        ? [
              result.added.length > 0 ? m.downloads_selection_added({ count: result.added.length }) : null,
              result.existing.length > 0 ? m.downloads_selection_existing({ count: result.existing.length }) : null,
              result.failed.length > 0 ? m.downloads_selection_failed({ count: result.failed.length }) : null,
          ]
              .filter(Boolean)
              .join(" · ")
        : null;

    return (
        <div
            ref={root}
            className="pointer-events-none absolute right-4 bottom-4 z-20 flex max-w-[calc(100%-2rem)] flex-col items-end gap-2"
        >
            {mode && (
                <fieldset
                    data-app-controls=""
                    aria-label={m.downloads_selection_actions()}
                    onFocusCapture={() => {
                        focusWithin.current = true;
                    }}
                    onBlurCapture={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) focusWithin.current = false;
                    }}
                    className="pointer-events-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
                >
                    <span role="status" aria-atomic="true" className="px-2 font-medium text-sm">
                        {pending
                            ? m.downloads_selection_adding({ completed: pending.completed, total: pending.total })
                            : m.downloads_selection_count({ count: selected.size })}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={hasSelection ? store.clear : store.selectAll}
                        disabled={pending !== null || (!hasSelection && visibleIds.length === 0)}
                        title={
                            hasSelection
                                ? m.downloads_selection_deselect()
                                : scope === "loaded"
                                  ? m.downloads_selection_all_loaded()
                                  : m.downloads_selection_all_page()
                        }
                    >
                        {hasSelection ? m.downloads_selection_deselect() : m.downloads_selection_all()}
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => {
                            void download(store);
                        }}
                        disabled={pending !== null || selected.size === 0}
                    >
                        <HugeiconsIcon icon={DownloadIcon} />
                        {m.downloads_selection_download()}
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={exit} aria-label={m.downloads_selection_exit()}>
                        <HugeiconsIcon icon={CloseIcon} className="size-3.5" />
                    </Button>
                </fieldset>
            )}
            {resultText && (
                <div
                    role="status"
                    aria-atomic="true"
                    className={cn(
                        "max-w-full rounded-xl border border-border bg-popover px-3 py-2 text-center text-popover-foreground text-xs shadow-sm",
                        result && result.failed.length > 0 && "text-destructive",
                    )}
                >
                    {resultText}
                </div>
            )}
        </div>
    );
}

export function SelectionActionBar() {
    const { active } = useSelectionContext();
    return active ? <ActiveSelectionActionBar key={active.id} store={active} /> : null;
}
