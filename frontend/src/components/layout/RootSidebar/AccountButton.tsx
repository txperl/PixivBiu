import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { MoreIcon } from "@/lib/icons";

function AccountButton() {
    return (
        <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
                <div
                    className="flex size-8 shrink-0 items-center justify-center rounded-full font-medium text-sm text-white"
                    style={{ background: "linear-gradient(135deg, oklch(0.78 0.10 45), oklch(0.68 0.13 45))" }}
                >
                    你
                </div>
                <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground text-sm">你的账户</div>
                    <div className="font-mono text-[11px] text-muted-foreground">@you · premium</div>
                </div>
            </div>
            <Button variant="ghost" size="icon" className="rounded-full">
                <HugeiconsIcon icon={MoreIcon} size={16} strokeWidth={1.5} className="text-muted-foreground" />
            </Button>
        </div>
    );
}

export default AccountButton;
