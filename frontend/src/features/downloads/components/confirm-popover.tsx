import { type ReactElement, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ConfirmPopoverProps = {
    trigger: ReactElement;
    body: ReactNode;
    confirmLabel: string;
    danger?: boolean;
    side?: "top" | "bottom" | "left" | "right";
    align?: "start" | "center" | "end";
    contentClassName?: string;
    onConfirm: () => Promise<void> | void;
};

function ConfirmPopover({
    trigger,
    body,
    confirmLabel,
    danger,
    side = "top",
    align = "end",
    contentClassName,
    onConfirm,
}: ConfirmPopoverProps) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);

    const run = async () => {
        if (pending) return;
        setPending(true);
        try {
            await onConfirm();
        } finally {
            setPending(false);
            setOpen(false);
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={trigger} />
            <PopoverContent
                side={side}
                align={align}
                sideOffset={6}
                className={cn("w-auto min-w-56 gap-2 p-3", contentClassName)}
            >
                <div className="text-foreground text-sm">{body}</div>
                <div className="mt-1 flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                        取消
                    </Button>
                    <Button variant={danger ? "destructive" : "default"} size="sm" onClick={run} disabled={pending}>
                        {pending ? "处理中…" : confirmLabel}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default ConfirmPopover;
