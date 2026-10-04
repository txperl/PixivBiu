import { memo, useLayoutEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Illust } from "@/features/search/api";
import IllustCard from "./illust-card";
import { estimateCardHeight, ILLUST_GRID_CLASS } from "./illust-grid-layout";

type IllustGridProps = {
    illusts: Illust[];
    selected?: ReadonlySet<number>;
    selectMode?: boolean;
    selectionDisabled?: boolean;
    onToggle?: (id: number, control: HTMLElement) => void;
};

function IllustGrid({ illusts, selected, onToggle, selectMode = false, selectionDisabled = false }: IllustGridProps) {
    const gridRef = useRef<HTMLDivElement>(null);
    // Cards use content-visibility:auto, so off-screen ones skip style, layout and
    // paint and take this estimated height until they first render. Written to the
    // DOM directly, not through state, to avoid re-rendering the grid on resize. A
    // hidden kept-alive page measures 0 and keeps its last estimate.
    useLayoutEffect(() => {
        const grid = gridRef.current;
        if (!grid) return;
        const apply = () => {
            const height = estimateCardHeight(grid.clientWidth);
            if (height !== null) grid.style.setProperty("--illust-card-h", `${height}px`);
        };
        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(grid);
        return () => observer.disconnect();
    }, []);
    return (
        <div ref={gridRef} className={ILLUST_GRID_CLASS}>
            {illusts.map((il) => (
                <IllustCard
                    key={il.id}
                    illust={il}
                    selected={selected?.has(il.id)}
                    selectMode={selectMode}
                    onSelect={onToggle}
                    selectionDisabled={selectionDisabled}
                />
            ))}
        </div>
    );
}

export function IllustGridSkeleton({ count = 15 }: { count?: number }) {
    return (
        <div className={ILLUST_GRID_CLASS}>
            {Array.from({ length: count }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                <div key={i} className="overflow-hidden rounded-2xl bg-card">
                    <div className="p-2">
                        <Skeleton className="aspect-square w-full rounded-xl" />
                    </div>
                    <div className="px-3.5 pt-1 pb-3.5">
                        <div className="flex h-5 items-center">
                            <Skeleton className="h-3 w-3/4" />
                        </div>
                        <div className="mt-1.5 flex h-5 items-center gap-1.5">
                            <Skeleton className="size-[18px] rounded-full" />
                            <Skeleton className="h-3 flex-1" />
                            <Skeleton className="h-3 w-8" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default memo(IllustGrid);
