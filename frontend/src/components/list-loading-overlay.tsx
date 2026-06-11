import type { ReactNode } from "react";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { cn } from "@/lib/utils";

type ListLoadingOverlayProps = {
    // True while a numbered-pager list is fetching the requested page but the
    // screen still shows the previous one — i.e. the query's `isPlaceholderData`.
    // `keepPreviousPage` (lib/query/keep-previous-page.ts) keeps the prior page on
    // screen with no skeleton, so without this the UI looks frozen on a slow step
    // (notably bookmarks_desc/views_desc search, which fans out several upstream
    // pages). We dim the stale grid and float a loading dot near the top.
    active: boolean;
    children: ReactNode;
};

// Wraps a list/grid that pages in place. While `active`, the previous page dims
// (and stops taking clicks) and a LeapyLoading pill floats at the top of the
// viewport — the pagers all scrollAppToTop() on a jump, so the container top is
// the viewport top. Gated through useDelayedFlag so a fast (localhost / cached)
// step never flashes the indicator.
function ListLoadingOverlay({ active, children }: ListLoadingOverlayProps) {
    const show = useDelayedFlag(active);
    return (
        <div className="relative">
            <div className={cn("transition-opacity duration-200", show && "pointer-events-none opacity-40")}>
                {children}
            </div>
            {show && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center">
                    <span className="rounded-full bg-card/95 px-4 py-2 text-muted-foreground shadow-lg ring-1 ring-black/5 backdrop-blur">
                        <LeapyLoading size={8} />
                    </span>
                </div>
            )}
        </div>
    );
}

export default ListLoadingOverlay;
