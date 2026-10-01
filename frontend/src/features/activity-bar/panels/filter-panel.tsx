import { ScrollArea } from "@/components/ui/scroll-area";
import { GeneralFiltersSection, useGeneralFilters } from "@/features/filter";
import { countActiveGeneralFilters } from "@/features/filter/types";
import { useMessages } from "@/i18n";
import { useFilterPanelData } from "../items/filter";

function SectionHeader({ title, count, onReset }: { title: string; count: number; onReset?: (() => void) | null }) {
    const m = useMessages();
    const canReset = count > 0 && onReset != null;
    return (
        <div className="flex items-center justify-end font-medium text-foreground text-sm tracking-wider">
            {count > 0 && <span className="mr-1 font-semibold text-[10px] text-muted-foreground">({count})</span>}
            {canReset ? (
                <button
                    type="button"
                    onClick={onReset}
                    aria-label={m.filter_panel_reset_aria({ title })}
                    className="hover:underline"
                >
                    {m.filter_panel_reset()}
                </button>
            ) : (
                <span>{title}</span>
            )}
        </div>
    );
}

function EmptyState() {
    const m = useMessages();
    return (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
            <div className="font-medium text-foreground text-sm">{m.filter_panel_unsupported_title()}</div>
            <div className="text-muted-foreground text-xs leading-relaxed">{m.filter_panel_unsupported_hint()}</div>
        </div>
    );
}

function FilterPanel() {
    const m = useMessages();
    const data = useFilterPanelData();
    const { filters, resetFilters } = useGeneralFilters();

    if (!data) return <EmptyState />;

    const generalCount = countActiveGeneralFilters(filters);
    const specialCount = data.specialFiltersActiveCount;

    return (
        <div className="flex h-full flex-col">
            <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-4 p-3">
                    {data.specialFilters && (
                        <section className="flex flex-col gap-2.5">
                            <SectionHeader
                                title={m.filter_section_special()}
                                count={specialCount}
                                onReset={data.onResetSpecialFilters}
                            />
                            {data.specialFilters}
                        </section>
                    )}

                    <section className="flex flex-col gap-2.5">
                        <SectionHeader title={m.filter_section_general()} count={generalCount} onReset={resetFilters} />
                        <GeneralFiltersSection />
                    </section>
                </div>
            </ScrollArea>

            <div className="shrink-0 border-border border-t bg-sidebar p-3 text-muted-foreground text-xs">
                {data.totalBefore === 0
                    ? m.filter_panel_no_works()
                    : m.filter_panel_showing({ after: data.totalAfter, before: data.totalBefore })}
            </div>
        </div>
    );
}

export default FilterPanel;
