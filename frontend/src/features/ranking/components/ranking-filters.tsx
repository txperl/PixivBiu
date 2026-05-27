import { Button } from "@/components/ui/button";
import { RANKING_PERIODS, RANKING_VARIANTS, type RankingPeriod, type RankingVariantKey } from "@/features/ranking/api";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";

type Messages = ReturnType<typeof useMessages>;

function periodLabel(m: Messages, period: RankingPeriod): string {
    switch (period) {
        case "day":
            return m.ranking_period_day();
        case "week":
            return m.ranking_period_week();
        case "month":
            return m.ranking_period_month();
    }
}

function variantLabel(m: Messages, key: RankingVariantKey): string {
    switch (key) {
        case "all":
            return m.ranking_variant_all();
        case "male":
            return m.ranking_variant_male();
        case "female":
            return m.ranking_variant_female();
        case "manga":
            return m.common_manga();
        case "r18":
            return "R-18";
        case "male_r18":
            return m.ranking_variant_male_r18();
        case "female_r18":
            return m.ranking_variant_female_r18();
        case "original":
            return m.ranking_variant_original();
        case "rookie":
            return m.ranking_variant_rookie();
        case "r18g":
            return "R-18G";
    }
}

type RankingFiltersProps = {
    period: RankingPeriod;
    variantKey: RankingVariantKey;
    onPeriodChange: (next: RankingPeriod) => void;
    onVariantChange: (key: RankingVariantKey) => void;
};

function RankingFilters({ period, variantKey, onPeriodChange, onVariantChange }: RankingFiltersProps) {
    const m = useMessages();
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
                            {periodLabel(m, p)}
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
                                {variantLabel(m, v.key)}
                            </Button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default RankingFilters;
