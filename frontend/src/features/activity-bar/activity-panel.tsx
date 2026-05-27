import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { CloseIcon } from "@/lib/icons";
import { ITEM_DEFS } from "./items";
import { useActivityBar } from "./use-activity-bar";

function ActivityPanel() {
    const m = useMessages();
    const { activeItemId, close } = useActivityBar();
    if (!activeItemId) return null;
    const def = ITEM_DEFS.find((d) => d.id === activeItemId);
    if (!def) return null;
    const Body = def.Panel;
    return (
        <aside className="flex h-full flex-col bg-sidebar">
            <header className="flex h-10 shrink-0 items-center justify-between border-border border-b px-3">
                <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                    {def.label}
                </span>
                <Button variant="ghost" size="icon-xs" onClick={close} aria-label={m.common_collapse()}>
                    <HugeiconsIcon icon={CloseIcon} strokeWidth={2} />
                </Button>
            </header>
            <div className="min-h-0 flex-1">
                <Body />
            </div>
        </aside>
    );
}

export default ActivityPanel;
