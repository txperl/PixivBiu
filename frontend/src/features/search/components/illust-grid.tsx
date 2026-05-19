import { Skeleton } from "@/components/ui/skeleton";
import type { Illust } from "@/features/search/api";
import IllustCard from "./illust-card";

type IllustGridProps = {
    illusts: Illust[];
    selected?: Set<number>;
    onToggle?: (id: number) => void;
};

function IllustGrid({ illusts, selected, onToggle }: IllustGridProps) {
    const selectMode = (selected?.size ?? 0) > 0;
    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {illusts.map((il) => (
                <IllustCard
                    key={il.id}
                    illust={il}
                    selected={selected?.has(il.id)}
                    selectMode={selectMode}
                    onSelect={onToggle}
                />
            ))}
        </div>
    );
}

export function IllustGridSkeleton() {
    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {Array.from({ length: 15 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                <div key={i} className="overflow-hidden rounded-2xl bg-card">
                    <div className="p-2">
                        <Skeleton className="aspect-square w-full rounded-xl" />
                    </div>
                    <div className="px-3.5 pt-1 pb-3.5">
                        <Skeleton className="h-4 w-3/4" />
                        <div className="mt-2 flex items-center gap-1.5">
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

export default IllustGrid;
