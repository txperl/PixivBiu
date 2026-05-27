import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type SearchPagerProps = {
    currentPage: number;
    hasNext: boolean;
    onJump: (page: number) => void;
};

// Pixiv search has no total-count and no jump-ahead semantics. We simulate
// numbered pages: a 5-wide window centered on the current page, plus prev/next
// chevrons. Trying to render true page numbers (e.g., "of 42 pages") would lie.
const WINDOW = 2;

function SearchPager({ currentPage, hasNext, onJump }: SearchPagerProps) {
    const m = useMessages();
    const start = Math.max(1, currentPage - WINDOW);
    const end = currentPage + WINDOW;
    const pages: number[] = [];
    for (let p = start; p <= end; p++) pages.push(p);

    return (
        <nav className="flex items-center justify-center gap-1 pt-2 pb-4">
            <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={currentPage <= 1}
                onClick={() => onJump(currentPage - 1)}
                aria-label={m.common_prev_page()}
            >
                <HugeiconsIcon icon={ChevronLeftIcon} size={16} strokeWidth={1.5} />
            </Button>

            {pages.map((p) => {
                const isCurrent = p === currentPage;
                // Don't render pages strictly past the last known one.
                const beyondLast = p > currentPage && !hasNext;
                if (beyondLast) return null;
                return (
                    <Button
                        key={p}
                        type="button"
                        variant={isCurrent ? "default" : "ghost"}
                        onClick={() => onJump(p)}
                        className={cn("min-w-8 font-mono", !isCurrent && "text-muted-foreground")}
                        aria-current={isCurrent ? "page" : undefined}
                    >
                        {p}
                    </Button>
                );
            })}

            <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!hasNext}
                onClick={() => onJump(currentPage + 1)}
                aria-label={m.common_next_page()}
            >
                <HugeiconsIcon icon={ChevronRightIcon} size={16} strokeWidth={1.5} />
            </Button>
        </nav>
    );
}

export default SearchPager;
