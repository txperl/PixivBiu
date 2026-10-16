import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { observeImageReadiness } from "@/lib/image-readiness";
import { rewritePximgUrl } from "@/lib/pixiv-image";
import { cn } from "@/lib/utils";

// Matches the <img> `duration-300` reveal below.
const FADE_MS = 300;

type PximgImageProps = {
    src: string | null | undefined;
    alt: string;
    fallback: ReactNode;
    className?: string;
    // className sizes the wrapper; fit controls the image inside it.
    fit?: "cover" | "contain";
    loading?: "lazy" | "eager";
    reveal?: "fade" | "instant";
    onLoad?: (img: HTMLImageElement) => void;
    onReady?: (img: HTMLImageElement) => void;
    onError?: () => void;
};

function ImageContent({
    src,
    alt,
    fallback,
    className,
    fit = "cover",
    loading = "lazy",
    reveal = "fade",
    onLoad,
    onReady,
    onError,
}: PximgImageProps & { src: string }) {
    const imgRef = useRef<HTMLImageElement>(null);
    const settled = useRef(false);
    const loadNotified = useRef(false);
    const [loaded, setLoaded] = useState(false);
    const [errored, setErrored] = useState(false);
    const [fallbackGone, setFallbackGone] = useState(false);
    const notifyLoad = useEffectEvent((img: HTMLImageElement) => onLoad?.(img));
    const notifyReady = useEffectEvent((img: HTMLImageElement) => onReady?.(img));
    const notifyError = useEffectEvent(() => onError?.());

    useEffect(() => {
        const img = imgRef.current;
        // Activity restores settled images without replaying their reveal. A
        // decode interrupted by hiding is retried against the same cached element.
        if (!img || settled.current) return;
        return observeImageReadiness(img, {
            onLoad: () => {
                if (loadNotified.current) return;
                loadNotified.current = true;
                notifyLoad(img);
            },
            onReady: () => {
                settled.current = true;
                setLoaded(true);
                notifyReady(img);
            },
            onError: () => {
                settled.current = true;
                setErrored(true);
                notifyError();
            },
        });
    }, []);

    // Remove expensive placeholder art once covered. Re-arm on Activity reveal
    // if hiding interrupted the timer; instant consumers need no fade timer.
    useEffect(() => {
        if (!loaded || reveal === "instant") return;
        const timer = setTimeout(() => setFallbackGone(true), FADE_MS + 50);
        return () => clearTimeout(timer);
    }, [loaded, reveal]);

    return (
        <div className={cn("relative overflow-hidden", className)}>
            {((!fallbackGone && !(loaded && reveal === "instant")) || errored) && fallback}
            {!errored && (
                <img
                    ref={imgRef}
                    src={src}
                    alt={alt}
                    loading={loading}
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className={cn(
                        "absolute inset-0 size-full",
                        reveal === "fade" && "transition-opacity duration-300",
                        fit === "contain" ? "object-contain" : "object-cover",
                        loaded ? "opacity-100" : "opacity-0",
                    )}
                />
            )}
        </div>
    );
}

function PximgImage(props: PximgImageProps) {
    const url = rewritePximgUrl(props.src);
    if (!url) return <>{props.fallback}</>;
    // Source changes reset before paint and revoke the previous element's decode.
    return <ImageContent key={url} {...props} src={url} />;
}

export default PximgImage;
