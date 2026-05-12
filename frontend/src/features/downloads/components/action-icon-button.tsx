import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { type ReactNode, useState } from "react";
import type { DownloadApiError } from "@/features/downloads";
import { apiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import ConfirmPopover from "./confirm-popover";

export type ActionIconConfirm = {
    body: ReactNode;
    confirmLabel: string;
    danger?: boolean;
};

export type ActionIconButtonProps = {
    icon: IconSvgElement;
    title: string;
    ariaLabel?: string;
    onAction: () => Promise<void>;
    confirm?: ActionIconConfirm;
    error?: DownloadApiError;
    className?: string;
};

function ActionIconButton({ icon, title, ariaLabel, onAction, confirm, error, className }: ActionIconButtonProps) {
    const [pending, setPending] = useState(false);
    const titleAttr = error ? apiErrorMessage(error) : title;
    const label = ariaLabel ?? title;
    const triggerClass = cn(
        "flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 disabled:cursor-wait disabled:opacity-60",
        error && "ring-1 ring-destructive/40",
        className,
    );

    const run = async () => {
        if (pending) return;
        setPending(true);
        try {
            await onAction();
        } finally {
            setPending(false);
        }
    };

    const button = (
        <button
            type="button"
            className={triggerClass}
            title={titleAttr}
            aria-label={label}
            disabled={pending}
            onClick={confirm ? undefined : run}
        >
            <HugeiconsIcon icon={icon} size={14} strokeWidth={1.5} />
        </button>
    );

    if (!confirm) return button;
    return (
        <ConfirmPopover
            trigger={button}
            body={confirm.body}
            confirmLabel={confirm.confirmLabel}
            danger={confirm.danger}
            onConfirm={onAction}
        />
    );
}

export default ActionIconButton;
