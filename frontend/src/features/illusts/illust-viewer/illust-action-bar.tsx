import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIllustDownload } from "@/features/illusts/use-illust-download";
import { useMessages } from "@/i18n";
import { CheckIcon, DownloadIcon, ExternalLinkIcon, LoaderIcon } from "@/lib/icons";
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

function IllustActionBar({ illustId }: { illustId: number }) {
    const m = useMessages();
    return (
        <div className="inline-flex w-fit divide-x divide-border overflow-hidden rounded-lg border border-border">
            <DownloadCell illustId={illustId} />
            <ActionTooltip label={m.illust_open_on_pixiv()}>
                <a
                    href={`https://www.pixiv.net/artworks/${illustId}`}
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
