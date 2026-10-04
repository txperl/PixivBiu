import { HugeiconsIcon } from "@hugeicons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Illust } from "@/features/illusts/api";
import { BookmarkPopover } from "@/features/illusts/components/bookmark-popover";
import { BookmarkNavigationReset, useIllustBookmark } from "@/features/illusts/use-illust-bookmark";
import { useMessages } from "@/i18n";
import { formatCount } from "@/lib/format";
import { HeartIcon, MagnetIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

function IllustBookmarkButton({ illust, className }: { illust: Illust; className?: string }) {
    const m = useMessages();
    const bookmark = useIllustBookmark({
        illustId: illust.id,
        isBookmarked: illust.is_bookmarked,
        bookmarkCount: illust.total_bookmarks,
    });
    const button = (
        <button
            ref={bookmark.buttonRef}
            type="button"
            onClick={(event) => {
                event.stopPropagation();
                bookmark.toggle();
            }}
            onMouseEnter={bookmark.openPopover}
            onMouseLeave={bookmark.scheduleClose}
            onKeyDown={bookmark.onPopoverKeyDown}
            disabled={bookmark.pending}
            aria-pressed={bookmark.bookmarked}
            aria-haspopup="dialog"
            aria-expanded={bookmark.popoverOpen}
            aria-label={bookmark.bookmarked ? m.illust_action_unbookmark() : m.illust_action_bookmark()}
            className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 font-mono outline-none disabled:cursor-wait disabled:opacity-70",
                bookmark.bookmarked ? "text-rose-500" : "text-muted-foreground hover:text-rose-500/70",
                bookmark.errorTitle && "ring-1 ring-destructive/40",
                className,
            )}
        >
            <span
                key={bookmark.popVersion}
                className={cn(
                    "inline-flex origin-center transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-rotate-6 group-hover:scale-125",
                    bookmark.popVersion > 0 && "animate-bookmark-pop",
                )}
            >
                <HugeiconsIcon
                    icon={bookmark.bookmarked && bookmark.currentRestrict === "private" ? MagnetIcon : HeartIcon}
                    size={11}
                    strokeWidth={1.5}
                    fill={bookmark.bookmarked ? "currentColor" : "none"}
                />
            </span>
            {formatCount(bookmark.count)}
        </button>
    );
    return (
        <>
            <Tooltip disabled={!bookmark.errorTitle}>
                <TooltipTrigger render={button} />
                <TooltipContent>{bookmark.errorTitle}</TooltipContent>
            </Tooltip>
            <BookmarkPopover bookmark={bookmark} illust={illust} />
            {bookmark.engaged && <BookmarkNavigationReset illustId={illust.id} onNavigate={bookmark.resetEditors} />}
        </>
    );
}
export default IllustBookmarkButton;
