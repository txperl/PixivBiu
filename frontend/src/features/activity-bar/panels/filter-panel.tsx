import { Button } from "@/components/ui/button";
import { GeneralFiltersSection, useGeneralFilters } from "@/features/filter";
import { countActiveGeneralFilters } from "@/features/filter/types";
import { useFilterPanelData } from "../items/filter";

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

function FilterPanel() {
    const data = useFilterPanelData();
    const { filters, resetFilters } = useGeneralFilters();

    if (!data) return <EmptyState />;

    const generalCount = countActiveGeneralFilters(filters);
    const specialCount = data.specialFiltersActiveCount;

    return (
        <div className="flex flex-col gap-4 p-3">
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

            <div className="text-muted-foreground text-xs">
                {data.totalBefore === 0 ? "当前页面暂无作品" : `显示 ${data.totalAfter} / ${data.totalBefore} 项`}
            </div>
        </div>
    );
}

export default FilterPanel;
