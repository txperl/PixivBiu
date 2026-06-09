import { HugeiconsIcon } from "@hugeicons/react";
import type { MouseEvent } from "react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BookmarkRestrictOptions } from "@/features/illusts/components/bookmark-restrict-options";
import { useIllustBookmark } from "@/features/illusts/use-illust-bookmark";
import { formatCount } from "@/lib/format";
import { HeartIcon, MagnetIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type IllustBookmarkButtonProps = {
    illustId: number;
    isBookmarked: boolean;
    bookmarkCount: number;
    className?: string;
};

function IllustBookmarkButton({ illustId, isBookmarked, bookmarkCount, className }: IllustBookmarkButtonProps) {
    const {
        bookmarked,
        count,
        pending,
        errorTitle,
        currentRestrict,
        restrictLoading,
        popoverOpen,
        setPopoverOpen,
        popVersion,
        buttonRef,
        openPopover,
        scheduleClose,
        toggle,
        pickRestrict,
    } = useIllustBookmark({ illustId, isBookmarked, bookmarkCount });

    const onClick = (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        toggle();
    };

    const button = (
        <button
            ref={buttonRef}
            type="button"
            onClick={onClick}
            onMouseEnter={openPopover}
            onMouseLeave={scheduleClose}
            disabled={pending}
            aria-pressed={bookmarked}
            className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 font-mono outline-none disabled:cursor-wait disabled:opacity-70",
                bookmarked ? "text-rose-500" : "text-muted-foreground hover:text-rose-500/70",
                errorTitle && "ring-1 ring-destructive/40",
                className,
            )}
        >
            <span
                key={popVersion}
                className={cn(
                    "inline-flex origin-center transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-rotate-6 group-hover:scale-125",
                    popVersion > 0 && "animate-bookmark-pop",
                )}
            >
                <HugeiconsIcon
                    icon={bookmarked && currentRestrict === "private" ? MagnetIcon : HeartIcon}
                    size={11}
                    strokeWidth={1.5}
                    fill={bookmarked ? "currentColor" : "none"}
                />
            </span>
            {formatCount(count)}
        </button>
    );

    return (
        <>
            {errorTitle ? (
                <Tooltip>
                    <TooltipTrigger render={button} />
                    <TooltipContent>{errorTitle}</TooltipContent>
                </Tooltip>
            ) : (
                button
            )}
            {/* In the error state the error tooltip is the only hover affordance —
                don't also surface the public/private chooser. */}
            {!errorTitle && (
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                    <PopoverContent
                        anchor={buttonRef}
                        side="top"
                        align="end"
                        sideOffset={6}
                        className="w-auto p-1"
                        initialFocus={false}
                        finalFocus={false}
                        onMouseEnter={openPopover}
                        onMouseLeave={scheduleClose}
                    >
                        <BookmarkRestrictOptions
                            currentRestrict={currentRestrict}
                            restrictLoading={restrictLoading}
                            pending={pending}
                            onPick={pickRestrict}
                        />
                    </PopoverContent>
                </Popover>
            )}
        </>
    );
}

export default IllustBookmarkButton;
