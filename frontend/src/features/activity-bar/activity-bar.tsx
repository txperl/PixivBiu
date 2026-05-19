import { HugeiconsIcon } from "@hugeicons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useGeneralFilters } from "@/features/filter";
import { isGeneralFiltersDefault } from "@/features/filter/types";
import { cn } from "@/lib/utils";
import { type ActivityItemDef, ITEM_DEFS } from "./items";
import { FILTER_ID, useFilterPanelData } from "./items/filter";
import { useActivityBar } from "./use-activity-bar";

function ActivityBarButton({ def, indicator }: { def: ActivityItemDef; indicator: boolean }) {
    const { activeItemId, isOpen, toggle } = useActivityBar();
    const active = activeItemId === def.id && isOpen;

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        onClick={() => toggle(def.id)}
                        aria-label={def.label}
                        aria-pressed={active}
                        className={cn(
                            "relative flex size-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
                            active && "text-foreground",
                        )}
                    >
                        <span
                            aria-hidden
                            className={cn(
                                "absolute top-1 bottom-1 left-0 w-0.5 rounded-r-full transition-colors",
                                active ? "bg-primary" : "bg-transparent",
                            )}
                        />
                        <HugeiconsIcon icon={def.icon} size={16} strokeWidth={2} />
                        {indicator && (
                            <span
                                aria-hidden
                                className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-destructive ring-1 ring-sidebar"
                            />
                        )}
                    </button>
                }
            />
            <TooltipContent side="left">{def.label}</TooltipContent>
        </Tooltip>
    );
}

function ActivityBar() {
    const { filters } = useGeneralFilters();
    const filterData = useFilterPanelData();
    const filterDot = !isGeneralFiltersDefault(filters) || (filterData?.specialFiltersActiveCount ?? 0) > 0;

    return (
        <aside className="flex h-full w-8 shrink-0 flex-col items-center gap-1 border-border border-l bg-sidebar py-2">
            {ITEM_DEFS.map((def) => (
                <ActivityBarButton key={def.id} def={def} indicator={def.id === FILTER_ID && filterDot} />
            ))}
        </aside>
    );
}

export default ActivityBar;
