import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";

type SheetProps = {
    children: React.ReactNode;
    className?: string;
};

function Sheet({ children, className }: SheetProps) {
    return <div className={cn("overflow-hidden rounded-2xl bg-card", className)}>{children}</div>;
}

type SheetHeadProps = {
    icon: IconSvgElement;
    title: string;
    meta?: string;
    actions?: React.ReactNode;
};

function SheetHead({ icon, title, meta, actions }: SheetHeadProps) {
    return (
        <div className="flex items-center gap-3 px-[18px] py-3.5">
            <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
            </div>
            <h2 className="m-0 font-medium text-base text-foreground">{title}</h2>
            {meta && <span className="font-mono text-muted-foreground text-xs">{meta}</span>}
            <div className="flex-1" />
            <div className="flex gap-1">{actions}</div>
        </div>
    );
}

export { Sheet, SheetHead };
