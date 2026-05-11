import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DownloadApiError } from "@/features/downloads";
import { apiErrorMessage } from "@/lib/api";
import { CloseIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type RemovePopoverProps = {
    jobId: string;
    remove: (jobId: string, purgeFiles: boolean) => Promise<void>;
    error?: DownloadApiError;
    trigger?: React.ReactElement;
    triggerClassName?: string;
};

function RemovePopover({ jobId, remove, error, trigger, triggerClassName }: RemovePopoverProps) {
    const [open, setOpen] = useState(false);
    const [purge, setPurge] = useState(false);
    const [pending, setPending] = useState(false);

    const onConfirm = async () => {
        if (pending) return;
        setPending(true);
        await remove(jobId, purge);
        setPending(false);
        setOpen(false);
        setPurge(false);
    };

    const defaultTrigger = (
        <button
            type="button"
            className={cn(
                "flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60",
                error && "ring-1 ring-destructive/40",
                triggerClassName,
            )}
            title={error ? apiErrorMessage(error) : "移除"}
            aria-label="移除"
        >
            <HugeiconsIcon icon={CloseIcon} size={14} strokeWidth={1.5} />
        </button>
    );

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={trigger ?? defaultTrigger} />
            <PopoverContent side="top" align="end" sideOffset={6} className="w-auto min-w-56 gap-2 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-foreground text-sm">
                    <input
                        type="checkbox"
                        checked={purge}
                        onChange={(e) => setPurge(e.target.checked)}
                        className="size-4 accent-primary"
                    />
                    同时删除已下载文件
                </label>
                <div className="mt-1 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                        取消
                    </Button>
                    <Button variant="destructive" size="sm" onClick={onConfirm} disabled={pending}>
                        {pending ? "移除中…" : "移除"}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default RemovePopover;
