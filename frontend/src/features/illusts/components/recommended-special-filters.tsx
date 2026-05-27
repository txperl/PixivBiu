import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FilterRow from "@/features/filter/components/filter-row";
import Segmented from "@/features/filter/components/segmented";
import type { IllustType } from "@/features/illusts/api";
import { useMessages } from "@/i18n";

type Props = {
    type: IllustType | undefined;
    includeRankingIllusts: boolean;
    onTypeChange: (v: IllustType | undefined) => void;
    onIncludeRankingChange: (v: boolean) => void;
};

function RecommendedSpecialFilters({ type, includeRankingIllusts, onTypeChange, onIncludeRankingChange }: Props) {
    const m = useMessages();
    const typeItems = [
        { value: "__any__", label: m.common_all() },
        { value: "illust", label: m.common_illust() },
        { value: "manga", label: m.common_manga() },
    ] as const;

    return (
        <div className="flex flex-col gap-3">
            <FilterRow label={m.filter_illust_type_label()} inactive={type === undefined}>
                <Select
                    items={typeItems}
                    value={type ?? "__any__"}
                    onValueChange={(v) => {
                        if (typeof v !== "string") return;
                        onTypeChange(v === "__any__" ? undefined : (v as IllustType));
                    }}
                >
                    <SelectTrigger size="sm" className="w-full text-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {typeItems.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </FilterRow>
            <FilterRow label={m.filter_recommended_ranking_label()} inactive={includeRankingIllusts}>
                <Segmented
                    value={includeRankingIllusts ? "on" : "off"}
                    options={[
                        { value: "on", label: m.filter_recommended_ranking_keep() },
                        { value: "off", label: m.filter_recommended_ranking_exclude() },
                    ]}
                    onChange={(v) => onIncludeRankingChange(v === "on")}
                />
            </FilterRow>
        </div>
    );
}

export default RecommendedSpecialFilters;
