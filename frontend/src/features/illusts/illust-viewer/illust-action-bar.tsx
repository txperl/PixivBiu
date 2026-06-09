import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactElement } from "react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Illust } from "@/features/illusts/api";
import { BookmarkRestrictOptions } from "@/features/illusts/components/bookmark-restrict-options";
import type { IllustBookmark } from "@/features/illusts/use-illust-bookmark";
import { useIllustDownload } from "@/features/illusts/use-illust-download";
import { useMessages } from "@/i18n";
import { CheckIcon, DownloadIcon, ExternalLinkIcon, HeartIcon, LoaderIcon, MagnetIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

// One equal-width cell of the segmented action group. Icon-only with a tooltip
// label; kept hoverable while busy (no `disabled`) so the tooltip still shows —
// handlers guard against re-entry instead.
const CELL =
    "flex size-8 cursor-pointer items-center justify-center text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground";
const ICON_SIZE = 16;

function ActionTooltip({ label, children }: { label: string; children: ReactElement }) {
    return (
        <Tooltip>
            <TooltipTrigger render={children} />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

// The bookmark COUNT lives in the read-only stats row; this cell is the toggle
// plus a hover popover to pick public/private (so the restrict choice matches the
// card, instead of forcing public). Driven by the footer-owned useIllustBookmark.
// On error it swaps the restrict popover for an error tooltip, like the card.
function BookmarkCell({ bookmark }: { bookmark: IllustBookmark }) {
    const m = useMessages();
    const {
        bookmarked,
        errorTitle,
        currentRestrict,
        restrictLoading,
        pending,
        popoverOpen,
        setPopoverOpen,
        buttonRef,
        openPopover,
        scheduleClose,
        toggle,
        pickRestrict,
    } = bookmark;
    const label = bookmarked ? m.illust_action_unbookmark() : m.illust_action_bookmark();
    const cell = (
        <button
            ref={buttonRef}
            type="button"
            onClick={toggle}
            onMouseEnter={openPopover}
            onMouseLeave={scheduleClose}
            aria-pressed={bookmarked}
            aria-label={errorTitle ?? label}
            className={cn(CELL, bookmarked && "text-rose-500 hover:text-rose-600", errorTitle && "text-destructive")}
        >
            <HugeiconsIcon
                icon={bookmarked && currentRestrict === "private" ? MagnetIcon : HeartIcon}
                size={ICON_SIZE}
                fill={bookmarked ? "currentColor" : "none"}
                strokeWidth={1.8}
            />
        </button>
    );
    return (
        <>
            {errorTitle ? (
                <Tooltip>
                    <TooltipTrigger render={cell} />
                    <TooltipContent>{errorTitle}</TooltipContent>
                </Tooltip>
            ) : (
                cell
            )}
            {/* In the error state the error tooltip is the only hover affordance —
                don't also surface the public/private chooser. */}
            {!errorTitle && (
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                    <PopoverContent
                        anchor={buttonRef}
                        side="top"
                        align="center"
                        sideOffset={8}
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

// Download cell — shares useIllustDownload with the card button, so the "sent"
// check only appears once the job completes (never mid-download). The icon spins
// while active and the percent shows in the tooltip; an enqueue/task failure
// surfaces as a destructive tint + error tooltip.
function DownloadCell({ illustId }: { illustId: number }) {
    const m = useMessages();
    const { downloading, justSent, errorTitle, percent, trigger } = useIllustDownload(illustId);

    const label =
        errorTitle ??
        (downloading
            ? `${m.downloads_btn_downloading()}${percent != null ? ` ${Math.round(percent * 100)}%` : ""}`
            : m.downloads_btn_download());
    const icon = justSent ? CheckIcon : downloading ? LoaderIcon : DownloadIcon;
    return (
        <ActionTooltip label={label}>
            <button
                type="button"
                onClick={trigger}
                aria-label={label}
                className={cn(CELL, errorTitle && "text-destructive")}
            >
                <HugeiconsIcon
                    icon={icon}
                    size={ICON_SIZE}
                    strokeWidth={1.8}
                    className={cn(downloading && "animate-spin")}
                />
            </button>
        </ActionTooltip>
    );
}

function IllustActionBar({ illust, bookmark }: { illust: Illust; bookmark: IllustBookmark }) {
    const m = useMessages();
    return (
        <div className="inline-flex w-fit divide-x divide-border overflow-hidden rounded-lg border border-border">
            <BookmarkCell bookmark={bookmark} />
            <DownloadCell illustId={illust.id} />
            <ActionTooltip label={m.illust_open_on_pixiv()}>
                <a
                    href={`https://www.pixiv.net/artworks/${illust.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={m.illust_open_on_pixiv()}
                    className={CELL}
                >
                    <HugeiconsIcon icon={ExternalLinkIcon} size={ICON_SIZE} strokeWidth={1.8} />
                </a>
            </ActionTooltip>
        </div>
    );
}

export default IllustActionBar;
