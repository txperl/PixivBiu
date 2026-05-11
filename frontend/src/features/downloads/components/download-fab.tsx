import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDownloads } from "@/features/downloads";
import { CheckIcon, CloseIcon, DownloadIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type DownloadFABProps = {
    selectedIllustIds: number[];
    onClearSelection: () => void;
};

function DownloadFAB({ selectedIllustIds, onClearSelection }: DownloadFABProps) {
    const { submit } = useDownloads();
    const [pending, setPending] = useState(false);
    const [doneLabel, setDoneLabel] = useState<string | null>(null);
    const [errorTitle, setErrorTitle] = useState<string | null>(null);
    const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
        () => () => {
            if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
        },
        [],
    );

    if (selectedIllustIds.length === 0 && !doneLabel) return null;

    const onSubmit = async () => {
        if (pending || selectedIllustIds.length === 0) return;
        setPending(true);
        setErrorTitle(null);
        const results = await Promise.all(selectedIllustIds.map((id) => submit(id)));
        const okCount = results.filter((r) => r !== null).length;
        const anyFailed = results.length !== okCount;
        setPending(false);
        if (anyFailed) setErrorTitle("部分作品添加失败");
        if (okCount > 0) {
            setDoneLabel(`已加入下载 ${okCount} 个`);
            if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
            doneTimerRef.current = setTimeout(() => {
                setDoneLabel(null);
                onClearSelection();
            }, 1500);
        }
    };

    return (
        <div className="fixed right-6 bottom-6 flex flex-col items-end gap-2">
            {doneLabel ? (
                <Button className="h-10 rounded-2xl px-3 text-xs" disabled>
                    <HugeiconsIcon icon={CheckIcon} strokeWidth={2} />
                    {doneLabel}
                </Button>
            ) : (
                <Button
                    className={cn("h-10 rounded-2xl px-3 text-xs", errorTitle && "ring-2 ring-destructive/40")}
                    onClick={onSubmit}
                    disabled={pending || selectedIllustIds.length === 0}
                    title={errorTitle ?? undefined}
                >
                    <HugeiconsIcon icon={DownloadIcon} />
                    {pending ? "添加中…" : `批量下载 (${selectedIllustIds.length})`}
                </Button>
            )}
            {selectedIllustIds.length > 0 && (
                <Button size="icon-lg" className="rounded-full" onClick={onClearSelection} disabled={pending}>
                    <HugeiconsIcon icon={CloseIcon} strokeWidth={2.5} />
                </Button>
            )}
        </div>
    );
}

export default DownloadFAB;
