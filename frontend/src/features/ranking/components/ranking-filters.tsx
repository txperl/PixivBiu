import { Button } from "@/components/ui/button";
import { RANKING_PERIODS, RANKING_VARIANTS, type RankingPeriod, type RankingVariantKey } from "@/features/ranking/api";
import { cn } from "@/lib/utils";

const PERIOD_LABELS: Record<RankingPeriod, string> = {
    day: "日榜",
    week: "周榜",
    month: "月榜",
};

type RankingFiltersProps = {
    period: RankingPeriod;
    variantKey: RankingVariantKey;
    onPeriodChange: (next: RankingPeriod) => void;
    onVariantChange: (key: RankingVariantKey) => void;
};

function RankingFilters({ period, variantKey, onPeriodChange, onVariantChange }: RankingFiltersProps) {
    const variants = RANKING_VARIANTS[period];

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                {RANKING_PERIODS.map((p) => {
                    const active = p === period;
                    return (
                        <Button
                            key={p}
                            type="button"
                            size="xs"
                            variant={active ? "default" : "ghost"}
                            onClick={() => onPeriodChange(p)}
                            className={cn(!active && "text-muted-foreground")}
                            aria-pressed={active}
                        >
                            {PERIOD_LABELS[p]}
                        </Button>
                    );
                })}
            </div>

            {variants.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {variants.map((v) => {
                        const active = v.key === variantKey;
                        return (
                            <Button
                                key={v.key}
                                type="button"
                                size="xs"
                                variant={active ? "secondary" : "ghost"}
                                onClick={() => onVariantChange(v.key)}
                                className={cn(!active && "text-muted-foreground")}
                                aria-pressed={active}
                            >
                                {v.label}
                            </Button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default RankingFilters;
