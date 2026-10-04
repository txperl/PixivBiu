import { type ReactNode, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

export function BookmarkTagScrollArea({
    children,
    className,
    canLoadMore,
    onLoadMore,
}: {
    children: ReactNode;
    className: string;
    canLoadMore: boolean;
    onLoadMore: () => Promise<unknown>;
}) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const endRef = useRef<HTMLDivElement | null>(null);
    const loading = useRef(false);
    const loadMore = useRef(onLoadMore);
    loadMore.current = onLoadMore;
    useEffect(() => {
        if (!canLoadMore || !viewportRef.current || !endRef.current) return;
        let active = true;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!active || !entry?.isIntersecting || loading.current) return;
                loading.current = true;
                void loadMore
                    .current()
                    .catch(() => {
                        // Query owns read errors and the explicit retry action.
                    })
                    .finally(() => {
                        loading.current = false;
                    });
            },
            { root: viewportRef.current },
        );
        observer.observe(endRef.current);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [canLoadMore]);
    return (
        <ScrollArea className={className} viewportProps={{ ref: viewportRef, className: "[overflow-anchor:none]" }}>
            <div className="relative">
                {children}
                <div
                    ref={endRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute right-0 bottom-0 size-px"
                />
            </div>
        </ScrollArea>
    );
}
