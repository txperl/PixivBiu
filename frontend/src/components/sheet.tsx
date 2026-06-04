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
        <div className="flex items-center gap-3 border-muted/40 border-b px-[18px] py-3">
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

// Fixed-height body region for a Sheet panel. Owns the panel body height so
// call sites don't repeat the magic number, and gives a definite height for
// children like ScrollArea (h-full) or SheetEmpty to fill.
function SheetBody({ children }: { children: React.ReactNode }) {
    return <div className="h-[300px]">{children}</div>;
}

type SheetEmptyProps = {
    icon: IconSvgElement;
    title: string;
    hint?: string;
};

// Centered empty state for a Sheet body. Fills its parent's height — render
// inside a SheetBody (or any definite-height container) so the soft icon
// medallion + copy sit centered instead of leaving the panel looking desolate.
function SheetEmpty({ icon, title, hint }: SheetEmptyProps) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground/70">
                <HugeiconsIcon icon={icon} size={24} strokeWidth={1.5} />
            </div>
            <div className="space-y-1">
                <p className="m-0 font-medium text-foreground text-sm">{title}</p>
                {hint && <p className="m-0 text-muted-foreground text-xs leading-relaxed">{hint}</p>}
            </div>
        </div>
    );
}

export { Sheet, SheetBody, SheetEmpty, SheetHead };
