import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useDownloadMutations } from "@/features/downloads";
import { GeneralFiltersSection, useGeneralFilters } from "@/features/filter";
import { countActiveGeneralFilters } from "@/features/filter/types";
import { DownloadIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { type QuickActionData, useFilterPanelData } from "../items/filter";

function SectionHeader({
    title,
    tip,
    count,
    action,
}: {
    title: string;
    tip: string;
    count: number;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
                <div className="font-medium text-foreground text-xs uppercase tracking-wider">
                    {title}
                    {count > 0 && <span className="ml-1 font-semibold text-muted-foreground">({count})</span>}
                </div>
                {action}
            </div>
            <div className="text-[11px] text-muted-foreground leading-snug">{tip}</div>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
            <div className="font-medium text-foreground text-sm">当前页面不支持筛选</div>
            <div className="text-muted-foreground text-xs leading-relaxed">
                进入作品列表（首页、搜索、排行榜、用户）后即可使用。
            </div>
        </div>
    );
}

function FilterPanelActions({ quickAction }: { quickAction: QuickActionData }) {
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
        if (anyFailed) setErrorTitle("部分作品添加失败");
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
                    {hasSelection ? `取消选择 (${selectedCount})` : `全选 (${allCount})`}
                </Button>
                <Button
                    className={cn(errorTitle && "ring-2 ring-destructive/40")}
                    onClick={onSubmit}
                    disabled={pending || selectedCount === 0}
                >
                    <HugeiconsIcon icon={DownloadIcon} />
                    {pending ? "添加中…" : `下载 (${selectedCount})`}
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
    return (
        <div className="flex shrink-0 flex-col gap-2 border-border border-t bg-sidebar p-3">
            <div className="text-muted-foreground text-xs">
                {totalBefore === 0 ? "当前页面暂无作品" : `显示 ${totalAfter} / ${totalBefore} 项`}
            </div>
            {quickAction && <FilterPanelActions quickAction={quickAction} />}
        </div>
    );
}

function FilterPanel() {
    const data = useFilterPanelData();
    const { filters, resetFilters } = useGeneralFilters();

    if (!data) return <EmptyState />;

    const generalCount = countActiveGeneralFilters(filters);
    const specialCount = data.specialFiltersActiveCount;

    return (
        <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
                {data.specialFilters && (
                    <section className="flex flex-col gap-2.5">
                        <SectionHeader
                            title="接口筛选"
                            tip="作为参数随请求发送，改动会触发重新拉取。"
                            count={specialCount}
                            action={
                                data.onResetSpecialFilters ? (
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        onClick={data.onResetSpecialFilters}
                                        disabled={specialCount === 0}
                                        aria-label="重置接口筛选"
                                    >
                                        重置
                                    </Button>
                                ) : undefined
                            }
                        />
                        {data.specialFilters}
                    </section>
                )}

                <section className="flex flex-col gap-2.5">
                    <SectionHeader
                        title="页面筛选"
                        tip="对当前结果做客户端过滤，设置全局生效并跨页面保留。"
                        count={generalCount}
                        action={
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={resetFilters}
                                disabled={generalCount === 0}
                                aria-label="重置页面筛选"
                            >
                                重置
                            </Button>
                        }
                    />
                    <GeneralFiltersSection />
                </section>
            </div>

            <FilterPanelFooter
                quickAction={data.quickAction}
                totalBefore={data.totalBefore}
                totalAfter={data.totalAfter}
            />
        </div>
    );
}

export default FilterPanel;
