import { useCallback, useLayoutEffect, useRef } from "react";
import { rewritePximgUrl } from "@/lib/pixiv-image";
import { useDragScroll } from "@/lib/use-drag-scroll";

// Where the user clicked to zoom, so the enlarged image can keep that point under the
// cursor. fracX/fracY: focal point as a fraction (0–1) of the image; cursorX/cursorY:
// the click position within the viewport, in px from its top-left.
export type ZoomAnchor = { fracX: number; fracY: number; cursorX: number; cursorY: number };

// Full-resolution overlay for the viewer stage: shows the image at natural size,
// pannable by mouse/touch drag (useDragScroll) and exitable by a plain click. A drag
// past the threshold is swallowed by the hook's onClickCapture so it doesn't also exit.
// Mouse-only by design: a plain div, not a button, so there's no keyboard activation.
function IllustZoomLayer({
    src,
    alt,
    anchor,
    onExit,
}: {
    src: string; // pixiv URL; rewritten here for the proxy
    alt: string;
    anchor: ZoomAnchor | null;
    onExit: () => void;
}) {
    const { ref, dragProps } = useDragScroll<HTMLDivElement>();
    const imgRef = useRef<HTMLImageElement>(null);

    // Scroll so the focal point lands back under the cursor's original screen position,
    // keeping the clicked spot put as the image enlarges. The image renders at natural
    // size (offsetWidth/Height === natural px) and m-auto pins it to the scroll origin
    // when it overflows, so scrollLeft/Top map straight to image pixels. An axis that
    // fits isn't scrollable (clamps to 0) and stays centered — the anchor is moot there.
    const positionToAnchor = useCallback(() => {
        const el = ref.current;
        const img = imgRef.current;
        if (!el || !img || !anchor) return;
        el.scrollLeft = anchor.fracX * img.offsetWidth - anchor.cursorX;
        el.scrollTop = anchor.fracY * img.offsetHeight - anchor.cursorY;
    }, [anchor, ref]);

    // A cached image (e.g. the multi-page large already shown in the stage) is complete
    // on mount — position before paint to avoid a jump. Async loads use onLoad below.
    useLayoutEffect(() => {
        const img = imgRef.current;
        if (img?.complete && img.naturalWidth > 0) positionToAnchor();
    }, [positionToAnchor]);

    return (
        // Flex scroll container with the image centered via `m-auto`. Per axis: when
        // the image fits, the auto margins center it; when it overflows that axis, the
        // auto margins collapse to 0 so the image pins to the start (scroll origin) and
        // the whole image stays scroll/drag-reachable. (Flex `items/justify-center`
        // would instead push the overflow above/left of the origin, where `overflow-auto`
        // can't scroll to it.)
        // biome-ignore lint/a11y/noStaticElementInteractions: mouse-only overlay by design
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard exit intentionally removed
        <div
            ref={ref}
            onClick={onExit}
            {...dragProps}
            className="scrollbar-none absolute inset-0 z-20 flex cursor-grab touch-none select-none overflow-auto bg-muted p-0 active:cursor-grabbing"
        >
            <img
                ref={imgRef}
                src={rewritePximgUrl(src) ?? undefined}
                alt={alt}
                referrerPolicy="no-referrer"
                decoding="async"
                draggable={false}
                onLoad={positionToAnchor}
                className="m-auto block max-w-none shrink-0 select-none"
            />
        </div>
    );
}

export default IllustZoomLayer;
