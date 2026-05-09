import { type ReactNode, type SyntheticEvent, useEffect, useState } from "react";
import { rewritePximgUrl } from "@/lib/pixiv-image";

type PximgImageProps = {
    src: string | null | undefined;
    alt: string;
    fallback: ReactNode;
    className?: string;
    onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void;
};

function PximgImage({ src, alt, fallback, className, onLoad }: PximgImageProps) {
    const [ok, setOk] = useState(true);
    const url = rewritePximgUrl(src);

    useEffect(() => {
        if (url) setOk(true);
    }, [url]);

    if (!ok || !url) return <>{fallback}</>;

    return (
        <img
            src={url}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setOk(false)}
            onLoad={onLoad}
            className={className}
        />
    );
}

export default PximgImage;
