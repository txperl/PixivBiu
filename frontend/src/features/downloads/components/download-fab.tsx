import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDownloadMutations } from "@/features/downloads";
import { CheckIcon, CloseIcon, DownloadIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type DownloadFABProps = {
    selected: Set<number>;
    allIllustIds: number[];
    onReplaceSelection: (ids: number[]) => void;
    onClearSelection: () => void;
};

function DownloadFAB({ selected, allIllustIds, onReplaceSelection, onClearSelection }: DownloadFABProps) {
    const { submit } = useDownloadMutations();
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

    const isAllSelected = useMemo(
        () => allIllustIds.length > 0 && allIllustIds.every((id) => selected.has(id)),
        [allIllustIds, selected],
    );

    const selectedCount = selected.size;
    if (selectedCount === 0 && !doneLabel) return null;

    const onSubmit = async () => {
        if (pending || selectedCount === 0) return;
        setPending(true);
        setErrorTitle(null);
        const results = await Promise.all([...selected].map((id) => submit(id)));
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

    const onToggleAll = () => {
        if (pending) return;
        onReplaceSelection(isAllSelected ? [] : allIllustIds);
    };

    return (
        <div className="fixed right-6 bottom-6 flex flex-col items-end gap-2">
            {!doneLabel && allIllustIds.length > 0 && selectedCount > 0 && (
                <Button
                    variant="secondary"
                    className="h-10 rounded-2xl px-3 text-xs"
                    onClick={onToggleAll}
                    disabled={pending}
                >
                    {isAllSelected ? "取消全选" : `全选 (${allIllustIds.length})`}
                </Button>
            )}
            {doneLabel ? (
                <Button className="h-10 rounded-2xl px-3 text-xs" disabled>
                    <HugeiconsIcon icon={CheckIcon} strokeWidth={2} />
                    {doneLabel}
                </Button>
            ) : (
                <Button
                    className={cn("h-10 rounded-2xl px-3 text-xs", errorTitle && "ring-2 ring-destructive/40")}
                    onClick={onSubmit}
                    disabled={pending || selectedCount === 0}
                    title={errorTitle ?? undefined}
                >
                    <HugeiconsIcon icon={DownloadIcon} />
                    {pending ? "添加中…" : `批量下载 (${selectedCount})`}
                </Button>
            )}
            {selectedCount > 0 && (
                <Button size="icon-lg" className="rounded-full" onClick={onClearSelection} disabled={pending}>
                    <HugeiconsIcon icon={CloseIcon} strokeWidth={2.5} />
                </Button>
            )}
        </div>
    );
}

export default DownloadFAB;
