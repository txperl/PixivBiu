import { HugeiconsIcon } from "@hugeicons/react";
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import PximgImage from "@/components/pximg-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type Illust, illustPageThumbUrls, illustPageUrls, illustZoomUrl } from "@/features/illusts/api";
import { useMessages } from "@/i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import IllustZoomLayer, { type ZoomAnchor } from "./illust-zoom-layer";
import { useViewerKeyboard, type ViewerKeyboardScope } from "./use-viewer-keyboard";
import { clampViewerPage } from "./viewer-navigation";

function StageArrow({
    side,
    disabled,
    onClick,
    label,
    shortcut,
}: {
    side: "left" | "right";
    disabled: boolean;
    onClick: () => void;
    label: string;
    shortcut?: "ArrowLeft" | "ArrowRight";
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        onClick={() => {
                            if (!disabled) onClick();
                        }}
                        aria-disabled={disabled}
                        aria-label={label}
                        aria-keyshortcuts={shortcut}
                        className={cn(
                            "absolute top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 aria-disabled:cursor-default aria-disabled:opacity-35",
                            side === "left" ? "left-3" : "right-3",
                        )}
                    />
                }
            >
                <HugeiconsIcon icon={side === "left" ? ChevronLeftIcon : ChevronRightIcon} size={20} strokeWidth={2} />
            </TooltipTrigger>
            <TooltipContent>
                {label}
                {shortcut && <kbd>{side === "left" ? "←" : "→"}</kbd>}
            </TooltipContent>
        </Tooltip>
    );
}

// Fraction (0–1) of a client point within an object-contain image's *painted* area,
// ignoring the letterbox bars. Lets the zoom layer re-anchor that same point.
function containFraction(clientX: number, clientY: number, img: HTMLImageElement) {
    const box = img.getBoundingClientRect();
    const natAspect = img.naturalWidth / img.naturalHeight;
    let w = box.width;
    let h = box.height;
    if (natAspect > box.width / box.height) h = box.width / natAspect;
    else w = box.height * natAspect;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return {
        fracX: clamp((clientX - (box.left + (box.width - w) / 2)) / w),
        fracY: clamp((clientY - (box.top + (box.height - h) / 2)) / h),
    };
}

function IllustStage({ illust, open, dialogRef, keyDownRef }: { illust: Illust } & ViewerKeyboardScope) {
    const m = useMessages();
    const pages = useMemo(() => illustPageUrls(illust), [illust]);
    const thumbs = useMemo(() => illustPageThumbUrls(illust), [illust]);
    const total = pages.length;

    const [page, setPage] = useState(0);
    const active = clampViewerPage(page, total);
    const [zoomed, setZoomed] = useState(false);
    const [anchor, setAnchor] = useState<ZoomAnchor | null>(null);
    const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const stageRef = useRef<HTMLDivElement>(null); // the area the zoom layer overlays
    const fitImgRef = useRef<HTMLImageElement | null>(null); // current fit-view <img>

    // Detail refreshes may replace a seeded page list. Clamp before looking up
    // the zoom URL, and persist the correction so later growth won't jump back.
    if (page !== active) {
        setPage(active);
        setZoomed(false);
    }

    const zoomSrc = useMemo(() => illustZoomUrl(illust, active), [illust, active]);

    const go = (next: number | ((current: number) => number)) => {
        setPage((current) => clampViewerPage(typeof next === "function" ? next(current) : next, total));
        setZoomed(false);
    };
    const step = (delta: -1 | 1) => go((current) => current + delta);
    useViewerKeyboard({ dialogRef, keyDownRef, open, zoomed, total, active, step });
    const shortcutsEnabled = open && !zoomed;

    // Zoom in anchored on the click: record the focal point (as a fraction of the
    // painted image) and where the cursor sits in the stage, so the enlarged image
    // keeps that spot under the cursor. Falls back to no anchor (centered view) if the
    // image isn't measurable yet (clicked before it loaded) or a synthetic click reports
    // detail 0 / clientX-Y 0, which aren't real coordinates.
    const openZoom = (e: ReactMouseEvent<HTMLDivElement>) => {
        const stage = stageRef.current;
        const img = fitImgRef.current;
        if (e.detail > 0 && stage && img?.isConnected && img.naturalWidth > 0) {
            const view = stage.getBoundingClientRect();
            const { fracX, fracY } = containFraction(e.clientX, e.clientY, img);
            setAnchor({ fracX, fracY, cursorX: e.clientX - view.left, cursorY: e.clientY - view.top });
        } else {
            setAnchor(null);
        }
        setZoomed(true);
    };

    // Keep the active thumbnail in view as pages change.
    useEffect(() => {
        thumbRefs.current[active]?.scrollIntoView({ inline: "center", block: "nearest" });
    }, [active]);

    const imageEl = (
        <PximgImage
            key={pages[active]}
            src={pages[active]}
            alt={illust.title}
            fit="contain"
            fallback={<div className="size-full bg-foreground/5" />}
            className="size-full"
            onLoad={(img) => {
                fitImgRef.current = img;
            }}
        />
    );

    return (
        <div className="relative flex h-[45vh] shrink-0 flex-col overflow-hidden bg-muted md:h-full md:min-w-0 md:flex-1">
            <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center">
                {/* Zoom is mouse-only by design — a plain clickable div, not a button, so it
                    isn't keyboard-activatable. */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse-only zoom by design */}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation intentionally removed */}
                <div onClick={openZoom} className="size-full cursor-zoom-in p-2 md:p-4">
                    {imageEl}
                </div>

                {total > 1 && (
                    <>
                        <StageArrow
                            side="left"
                            disabled={active === 0}
                            onClick={() => step(-1)}
                            label={m.common_prev_page()}
                            shortcut={shortcutsEnabled ? "ArrowLeft" : undefined}
                        />
                        <StageArrow
                            side="right"
                            disabled={active === total - 1}
                            onClick={() => step(1)}
                            label={m.common_next_page()}
                            shortcut={shortcutsEnabled ? "ArrowRight" : undefined}
                        />
                        <div
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                            className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[11px] text-white"
                        >
                            {m.illust_page_counter({ current: active + 1, total })}
                        </div>
                    </>
                )}

                {zoomed && (
                    // key remounts on page/source change so a new image re-anchors cleanly.
                    <IllustZoomLayer
                        key={zoomSrc}
                        src={zoomSrc}
                        alt={illust.title}
                        anchor={anchor}
                        onExit={() => setZoomed(false)}
                    />
                )}
            </div>

            {total > 1 && (
                <div className="scrollbar-none flex shrink-0 gap-2 overflow-x-auto border-border/60 border-t bg-muted p-2.5">
                    {pages.map((src, i) => (
                        <button
                            key={src}
                            ref={(el) => {
                                thumbRefs.current[i] = el;
                            }}
                            type="button"
                            onClick={() => go(i)}
                            aria-label={m.illust_go_to_page({ page: i + 1 })}
                            aria-current={i === active ? "true" : undefined}
                            className={cn(
                                "relative size-14 shrink-0 overflow-hidden rounded-md outline-offset-2 transition",
                                i === active ? "outline outline-2 outline-primary" : "opacity-60 hover:opacity-100",
                            )}
                        >
                            <PximgImage
                                src={thumbs[i]}
                                alt=""
                                fallback={<div className="size-full bg-muted-foreground/10" />}
                                className="size-full"
                            />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default IllustStage;
