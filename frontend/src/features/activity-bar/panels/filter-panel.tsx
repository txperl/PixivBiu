import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDownloadMutations } from "@/features/downloads";
import { GeneralFiltersSection, useGeneralFilters } from "@/features/filter";
import { countActiveGeneralFilters } from "@/features/filter/types";
import { useMessages } from "@/i18n";
import { DownloadIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { type QuickActionData, useFilterPanelData } from "../items/filter";

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

function FilterPanelActions({ quickAction }: { quickAction: QuickActionData }) {
    const m = useMessages();
    const { submit } = useDownloadMutations();
    const [pending, setPending] = useState(false);
    const [errorTitle, setErrorTitle] = useState<string | null>(null);

    const selectedCount = quickAction.selected.size;
    const hasSelection = selectedCount > 0;
    const allCount = quickAction.allIllustIds.length;

    const onSubmit = async () => {
        if (pending || selectedCount === 0) return;
        setPending(true);
        setErrorTitle(null);
        const results = await Promise.all([...quickAction.selected].map((id) => submit(id)));
        const okCount = results.filter((r) => r !== null).length;
        const anyFailed = results.length !== okCount;
        setPending(false);
        if (anyFailed) setErrorTitle(m.filter_panel_partial_failed());
        if (okCount > 0) quickAction.onClearSelection();
    };

    const onToggleSelect = () => {
        if (pending) return;
        if (hasSelection) quickAction.onClearSelection();
        else quickAction.onReplaceSelection(quickAction.allIllustIds);
    };

    return (
        <>
            <div className="grid grid-cols-2 gap-2">
                <Button
                    variant="secondary"
                    onClick={onToggleSelect}
                    disabled={pending || (!hasSelection && allCount === 0)}
                >
                    {hasSelection
                        ? m.filter_panel_deselect({ count: selectedCount })
                        : m.filter_panel_select_all({ count: allCount })}
                </Button>
                <Button
                    className={cn(errorTitle && "ring-2 ring-destructive/40")}
                    onClick={onSubmit}
                    disabled={pending || selectedCount === 0}
                >
                    <HugeiconsIcon icon={DownloadIcon} />
                    {pending ? m.filter_panel_adding() : m.filter_panel_download({ count: selectedCount })}
                </Button>
            </div>
            {errorTitle && <div className="text-destructive text-xs leading-relaxed">{errorTitle}</div>}
        </>
    );
}

function FilterPanelFooter({
    quickAction,
    totalBefore,
    totalAfter,
}: {
    quickAction: QuickActionData | null;
    totalBefore: number;
    totalAfter: number;
}) {
    const m = useMessages();
    return (
        <div className="flex shrink-0 flex-col gap-2 border-border border-t bg-sidebar p-3">
            <div className="text-muted-foreground text-xs">
                {totalBefore === 0
                    ? m.filter_panel_no_works()
                    : m.filter_panel_showing({ after: totalAfter, before: totalBefore })}
            </div>
            {quickAction && <FilterPanelActions quickAction={quickAction} />}
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

            <FilterPanelFooter
                quickAction={data.quickAction}
                totalBefore={data.totalBefore}
                totalAfter={data.totalAfter}
            />
        </div>
    );
}

export default FilterPanel;
