import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import PximgImage from "@/components/pximg-image";
import { type Illust, illustPageUrls } from "@/features/illusts/api";
import { useMessages } from "@/i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "@/lib/icons";
import { rewritePximgUrl } from "@/lib/pixiv-image";
import { cn } from "@/lib/utils";

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

function IllustStage({ illust }: { illust: Illust }) {
    const m = useMessages();
    // Original-resolution zoom is available only for single-page works
    // (meta_single_page.original_image_url) — meta_pages carry no original.
    const pages = useMemo(() => illustPageUrls(illust), [illust]);
    const total = pages.length;
    const original = total === 1 ? illust.meta_single_page?.original_image_url : undefined;
    const canZoom = !!original;

    const [active, setActive] = useState(0);
    const [zoomed, setZoomed] = useState(false);
    const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const go = (next: number) => {
        setActive(Math.min(total - 1, Math.max(0, next)));
        setZoomed(false);
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
        />
    );

    return (
        <div className="relative flex h-[45vh] shrink-0 flex-col overflow-hidden bg-muted md:h-full md:min-w-0 md:flex-1">
            <div className="relative flex min-h-0 flex-1 items-center justify-center">
                {canZoom ? (
                    <button
                        type="button"
                        onClick={() => setZoomed(true)}
                        aria-label={m.illust_zoom_original()}
                        className="size-full cursor-zoom-in p-2 md:p-4"
                    >
                        {imageEl}
                    </button>
                ) : (
                    <div className="size-full p-2 md:p-4">{imageEl}</div>
                )}

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

                {zoomed && original && (
                    <button
                        type="button"
                        onClick={() => setZoomed(false)}
                        aria-label={m.illust_zoom_fit()}
                        className="scrollbar-none absolute inset-0 z-20 flex cursor-zoom-out items-start justify-center overflow-auto bg-muted"
                    >
                        <img
                            src={rewritePximgUrl(original)}
                            alt={illust.title}
                            referrerPolicy="no-referrer"
                            decoding="async"
                            className="block max-w-none"
                        />
                    </button>
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
