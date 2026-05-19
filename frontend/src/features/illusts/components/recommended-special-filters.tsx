import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FilterRow from "@/features/filter/components/filter-row";
import Segmented from "@/features/filter/components/segmented";
import type { IllustType } from "@/features/illusts/api";

type Props = {
    type: IllustType | undefined;
    includeRankingIllusts: boolean;
    onTypeChange: (v: IllustType | undefined) => void;
    onIncludeRankingChange: (v: boolean) => void;
};

const TYPE_ITEMS = [
    { value: "__any__", label: "全部" },
    { value: "illust", label: "插画" },
    { value: "manga", label: "漫画" },
] as const;

function RecommendedSpecialFilters({ type, includeRankingIllusts, onTypeChange, onIncludeRankingChange }: Props) {
    return (
        <div className="flex flex-col gap-3">
            <FilterRow label="作品类型" inactive={type === undefined}>
                <Select
                    items={TYPE_ITEMS}
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
                            {TYPE_ITEMS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </FilterRow>
            <FilterRow label="每日排行注入" inactive={includeRankingIllusts}>
                <Segmented
                    value={includeRankingIllusts ? "on" : "off"}
                    options={[
                        { value: "on", label: "保留" },
                        { value: "off", label: "排除" },
                    ]}
                    onChange={(v) => onIncludeRankingChange(v === "on")}
                />
            </FilterRow>
        </div>
    );
}

export default RecommendedSpecialFilters;
