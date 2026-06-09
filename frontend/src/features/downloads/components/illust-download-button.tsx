import { HugeiconsIcon } from "@hugeicons/react";
import type { MouseEvent } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIllustDownload } from "@/features/illusts/use-illust-download";
import { useMessages } from "@/i18n";
import { CheckIcon, DownloadIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type IllustDownloadButtonProps = {
    illustId: number;
    className?: string;
};

const RING_RADIUS = 18;
const RING_CIRCUM = 2 * Math.PI * RING_RADIUS;
// Quarter-arc visible in indeterminate mode; combined with animate-spin gives a
// classic Material-style indeterminate spinner.
const INDETERMINATE_OFFSET = RING_CIRCUM * 0.75;

function IllustDownloadButton({ illustId, className }: IllustDownloadButtonProps) {
    const m = useMessages();
    const { downloading, justSent, errorTitle, percent, indeterminate, trigger } = useIllustDownload(illustId);

    const onClick = (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        trigger();
    };

    const dashOffset = indeterminate ? INDETERMINATE_OFFSET : RING_CIRCUM * (1 - (percent ?? 0));

    const colorClasses = errorTitle
        ? "bg-destructive text-white ring-2 ring-destructive/40"
        : downloading
          ? "bg-accent text-accent-foreground"
          : "bg-primary text-primary-foreground";

    const button = (
        <button
            type="button"
            onClick={onClick}
            disabled={downloading}
            aria-label={downloading ? m.downloads_btn_downloading() : m.downloads_btn_download()}
            className={cn(
                "absolute right-3.5 bottom-3.5 flex size-10 scale-90 items-center justify-center opacity-0 shadow-md transition-all duration-300 disabled:cursor-wait group-hover:scale-100 group-hover:opacity-100",
                colorClasses,
                downloading || justSent ? "rounded-[20px]" : "rounded-xl",
                (downloading || justSent) && "scale-100 opacity-100 group-hover:opacity-100",
                !downloading && "disabled:opacity-70 group-hover:disabled:opacity-70",
                className,
            )}
        >
            {downloading && (
                <span
                    className={cn(
                        "pointer-events-none absolute inset-0 flex items-center justify-center",
                        indeterminate && "animate-spin",
                    )}
                >
                    <svg
                        viewBox="0 0 40 40"
                        className={cn("size-full", !indeterminate && "-rotate-90")}
                        role="img"
                        aria-label={m.downloads_btn_progress()}
                    >
                        <title>{m.downloads_btn_progress()}</title>
                        <circle
                            cx="20"
                            cy="20"
                            r={RING_RADIUS}
                            fill="none"
                            strokeWidth="2"
                            className="stroke-accent-foreground/30"
                        />
                        <circle
                            cx="20"
                            cy="20"
                            r={RING_RADIUS}
                            fill="none"
                            strokeWidth="2"
                            strokeLinecap="round"
                            className="stroke-accent-foreground"
                            strokeDasharray={RING_CIRCUM}
                            strokeDashoffset={dashOffset}
                            style={{ transition: indeterminate ? "none" : "stroke-dashoffset 250ms linear" }}
                        />
                    </svg>
                </span>
            )}
            <HugeiconsIcon icon={justSent ? CheckIcon : DownloadIcon} size={16} strokeWidth={1.5} />
        </button>
    );

    if (!errorTitle) return button;
    return (
        <Tooltip>
            <TooltipTrigger render={button} />
            <TooltipContent>{errorTitle}</TooltipContent>
        </Tooltip>
    );
}

export default IllustDownloadButton;
