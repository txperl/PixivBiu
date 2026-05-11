import { HugeiconsIcon } from "@hugeicons/react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useDownloads } from "@/features/downloads";
import { CheckIcon, DownloadIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type IllustDownloadButtonProps = {
    illustId: number;
    className?: string;
};

function IllustDownloadButton({ illustId, className }: IllustDownloadButtonProps) {
    const { submit } = useDownloads();
    const [pending, setPending] = useState(false);
    const [justSent, setJustSent] = useState(false);
    const [errorTitle, setErrorTitle] = useState<string | null>(null);
    const sentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
        () => () => {
            if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
        },
        [],
    );

    const onClick = async (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (pending) return;
        setErrorTitle(null);
        setPending(true);
        const job = await submit(illustId);
        setPending(false);
        if (!job) {
            setErrorTitle("添加到下载队列失败");
            return;
        }
        setJustSent(true);
        if (sentTimerRef.current) clearTimeout(sentTimerRef.current);
        sentTimerRef.current = setTimeout(() => setJustSent(false), 1400);
    };

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={pending}
            title={errorTitle ?? undefined}
            aria-label="下载该作品"
            className={cn(
                "absolute right-3.5 bottom-3.5 flex size-10 scale-90 items-center justify-center rounded-xl bg-primary text-primary-foreground opacity-0 shadow-md transition-all group-hover:scale-100 group-hover:opacity-100 disabled:cursor-wait disabled:opacity-70 group-hover:disabled:opacity-70",
                justSent && "opacity-100 group-hover:opacity-100",
                errorTitle && "bg-destructive ring-2 ring-destructive/40",
                className,
            )}
        >
            <HugeiconsIcon icon={justSent ? CheckIcon : DownloadIcon} size={16} strokeWidth={1.5} />
        </button>
    );
}

export default IllustDownloadButton;
