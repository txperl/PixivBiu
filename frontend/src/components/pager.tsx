import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "@/lib/icons";
import { buildPageItems, type PagerState, pagerUpper } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type PagerProps = {
    state: PagerState;
    onJump: (page: number) => void;
    // Called when the user is about to pick a page (hover / focus), e.g. to prefetch it.
    onIntent?: (page: number) => void;
};

// Hovering must settle briefly before it counts, so sweeping the pointer across the row
// doesn't fire a request per button. Focus is deliberate and fires at once.
const HOVER_INTENT_MS = 150;

// Numbered pager over lib/pagination state: it renders only pages known to exist (plus a
// hinted last page when one is supplied) and hides itself when there's only one page.
function Pager({ state, onJump, onIntent }: PagerProps) {
    const m = useMessages();
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(hoverTimer.current), []);

    const upper = pagerUpper(state);
    const { current } = state;
    if (upper <= 1 && current <= 1) return null;

    const items = buildPageItems(state);
    const canNext = current < upper;

    const intentProps = (page: number) =>
        onIntent && page !== current
            ? {
                  onPointerEnter: () => {
                      clearTimeout(hoverTimer.current);
                      hoverTimer.current = setTimeout(() => onIntent(page), HOVER_INTENT_MS);
                  },
                  onPointerLeave: () => clearTimeout(hoverTimer.current),
                  onFocus: () => onIntent(page),
              }
            : {};

    return (
        <nav className="flex items-center justify-center gap-1 pt-2 pb-4">
            <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={current <= 1}
                // Past the end (an empty deep link), "previous" lands on the last known page.
                onClick={() => onJump(Math.min(current - 1, upper))}
                aria-label={m.common_prev_page()}
            >
                <HugeiconsIcon icon={ChevronLeftIcon} size={16} strokeWidth={1.5} />
            </Button>

            {items.map((item) => {
                if (item.kind === "ellipsis") {
                    return (
                        <span
                            key={item.key}
                            aria-hidden="true"
                            className="inline-flex h-8 min-w-8 select-none items-center justify-center font-mono text-muted-foreground text-sm"
                        >
                            …
                        </span>
                    );
                }
                const isCurrent = item.page === current;
                return (
                    <Button
                        key={item.page}
                        type="button"
                        variant={isCurrent ? "default" : "ghost"}
                        onClick={() => onJump(item.page)}
                        {...intentProps(item.page)}
                        className={cn("min-w-8 font-mono", !isCurrent && "text-muted-foreground")}
                        aria-current={isCurrent ? "page" : undefined}
                        aria-label={m.common_page_label({ page: item.page })}
                    >
                        {item.page}
                    </Button>
                );
            })}

            <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!canNext}
                onClick={() => onJump(current + 1)}
                {...(canNext ? intentProps(current + 1) : {})}
                aria-label={m.common_next_page()}
            >
                <HugeiconsIcon icon={ChevronRightIcon} size={16} strokeWidth={1.5} />
            </Button>
        </nav>
    );
}

export default Pager;
