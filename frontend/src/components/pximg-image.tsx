import { type ReactNode, useEffect, useRef, useState } from "react";
import { rewritePximgUrl } from "@/lib/pixiv-image";
import { cn } from "@/lib/utils";

// Matches the <img> `duration-300` reveal below.
const FADE_MS = 300;

type PximgImageProps = {
    src: string | null | undefined;
    alt: string;
    fallback: ReactNode;
    className?: string;
    // How the <img> fills its box. Defaults to "cover" (thumbnails/cards). The
    // viewer stage passes "contain" so the whole artwork is visible — note
    // `className` styles the wrapper, not the <img>, so fit can't be a className.
    fit?: "cover" | "contain";
    onLoad?: (img: HTMLImageElement) => void;
};

function PximgImage({ src, alt, fallback, className, fit = "cover", onLoad }: PximgImageProps) {
    const url = rewritePximgUrl(src);
    const imgRef = useRef<HTMLImageElement>(null);
    const [loaded, setLoaded] = useState(false);
    const [errored, setErrored] = useState(false);
    const [fallbackGone, setFallbackGone] = useState(false);
    const settledUrl = useRef<string | undefined>(undefined);

    // Reveal only after the full frame is decoded, so images don't paint
    // top-to-bottom. decode() is driven by the load event / cache-hit check
    // below, never eagerly on mount, so off-screen loading="lazy" images aren't
    // force-loaded.
    const handleLoaded = (img: HTMLImageElement) => {
        img.decode().then(
            () => setLoaded(true),
            () => setLoaded(true), // decode() can reject (e.g. src swapped); reveal anyway
        );
        onLoad?.(img);
    };

    // A cached image can finish loading before React attaches onLoad, so the
    // event never fires and the <img> would stay opacity-0 forever. Reveal the
    // already-complete case here (this also notifies onLoad — the popover
    // preview reads naturalWidth/naturalHeight from the element to size its box).
    // Guarded by the last handled url: effects re-run when a kept-alive page is shown
    // again, and resetting there would fade every already-revealed card back in.
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only on url change; handleLoaded/onLoad are recreated each render
    useEffect(() => {
        if (settledUrl.current === url) return;
        settledUrl.current = url;
        setLoaded(false);
        setErrored(false);
        setFallbackGone(false);
        const img = imgRef.current;
        if (img?.complete && img.naturalWidth > 0) handleLoaded(img);
    }, [url]);

    // Drop the fallback once the image has faded in: placeholder art carries blur
    // filters, and keeping one under every revealed thumbnail costs paint and
    // compositing for nothing. A timer (not transitionend) so a kept-alive page
    // hidden mid-fade re-arms it when shown again.
    useEffect(() => {
        if (!loaded) return;
        const timer = setTimeout(() => setFallbackGone(true), FADE_MS + 50);
        return () => clearTimeout(timer);
    }, [loaded]);

    if (!url) return <>{fallback}</>;

    return (
        <div className={cn("relative overflow-hidden", className)}>
            {/* Underlays the image until it is revealed. The box size comes from
                className, so removing it afterwards doesn't shift layout. */}
            {(!fallbackGone || errored) && fallback}
            {!errored && (
                <img
                    ref={imgRef}
                    src={url}
                    alt={alt}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onLoad={(e) => handleLoaded(e.currentTarget)}
                    onError={() => setErrored(true)}
                    className={cn(
                        "absolute inset-0 size-full transition-opacity duration-300",
                        fit === "contain" ? "object-contain" : "object-cover",
                        loaded ? "opacity-100" : "opacity-0",
                    )}
                />
            )}
        </div>
    );
}

export default PximgImage;
