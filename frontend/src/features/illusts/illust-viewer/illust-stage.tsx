import { HugeiconsIcon } from "@hugeicons/react";
import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import PximgImage from "@/components/pximg-image";
import { type Illust, illustPageUrls, illustZoomUrl } from "@/features/illusts/api";
import { useMessages } from "@/i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import IllustZoomLayer, { type ZoomAnchor } from "./illust-zoom-layer";

function StageArrow({
    side,
    disabled,
    onClick,
    label,
}: {
    side: "left" | "right";
    disabled: boolean;
    onClick: () => void;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className={cn(
                "absolute top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 disabled:pointer-events-none disabled:opacity-0",
                side === "left" ? "left-3" : "right-3",
            )}
        >
            <HugeiconsIcon icon={side === "left" ? ChevronLeftIcon : ChevronRightIcon} size={20} strokeWidth={2} />
        </button>
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

function IllustStage({ illust }: { illust: Illust }) {
    const m = useMessages();
    const pages = useMemo(() => illustPageUrls(illust), [illust]);
    const total = pages.length;

    const [active, setActive] = useState(0);
    const [zoomed, setZoomed] = useState(false);
    const [anchor, setAnchor] = useState<ZoomAnchor | null>(null);
    const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const stageRef = useRef<HTMLDivElement>(null); // the area the zoom layer overlays
    const fitImgRef = useRef<HTMLImageElement | null>(null); // current fit-view <img>

    const zoomSrc = useMemo(() => illustZoomUrl(illust, active), [illust, active]);

    const go = (next: number) => {
        setActive(Math.min(total - 1, Math.max(0, next)));
        setZoomed(false);
    };

    // Zoom in anchored on the click: record the focal point (as a fraction of the
    // painted image) and where the cursor sits in the stage, so the enlarged image
    // keeps that spot under the cursor. Falls back to no anchor (centered view) for
    // keyboard/assistive activation — those synthetic clicks report detail 0 and
    // clientX/Y 0, which aren't real coordinates — or if the image isn't measurable
    // yet (clicked before it loaded).
    const openZoom = (e: ReactMouseEvent<HTMLButtonElement>) => {
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

    // ←/→ navigate pages anywhere inside the open dialog (no text inputs to clash with).
    useEffect(() => {
        if (total <= 1) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") {
                setActive((a) => Math.max(0, a - 1));
                setZoomed(false);
            } else if (e.key === "ArrowRight") {
                setActive((a) => Math.min(total - 1, a + 1));
                setZoomed(false);
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [total]);

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
                <button
                    type="button"
                    onClick={openZoom}
                    aria-label={m.illust_zoom_original()}
                    className="size-full cursor-zoom-in p-2 md:p-4"
                >
                    {imageEl}
                </button>

                {total > 1 && (
                    <>
                        <StageArrow
                            side="left"
                            disabled={active === 0}
                            onClick={() => go(active - 1)}
                            label={m.common_prev_page()}
                        />
                        <StageArrow
                            side="right"
                            disabled={active === total - 1}
                            onClick={() => go(active + 1)}
                            label={m.common_next_page()}
                        />
                        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-1 font-mono text-[11px] text-white backdrop-blur-sm">
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
                        label={m.illust_zoom_fit()}
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
                            className={cn(
                                "relative size-14 shrink-0 overflow-hidden rounded-md outline-offset-2 transition",
                                i === active ? "outline outline-2 outline-primary" : "opacity-60 hover:opacity-100",
                            )}
                        >
                            <PximgImage
                                src={src}
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
