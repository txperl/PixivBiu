import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
            <div className="flex flex-col gap-1.5">
                <div className="text-muted-foreground text-xs">作品类型</div>
                <Select
                    items={TYPE_ITEMS}
                    value={type ?? "__any__"}
                    onValueChange={(v) => {
                        if (typeof v !== "string") return;
                        onTypeChange(v === "__any__" ? undefined : (v as IllustType));
                    }}
                >
                    <SelectTrigger className="h-8 w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            {TYPE_ITEMS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            <div className="flex flex-col gap-1.5">
                <div className="text-muted-foreground text-xs">每日排行注入</div>
                <Segmented
                    value={includeRankingIllusts ? "on" : "off"}
                    options={[
                        { value: "on", label: "保留" },
                        { value: "off", label: "排除" },
                    ]}
                    onChange={(v) => onIncludeRankingChange(v === "on")}
                />
            </div>
        </div>
    );
}

export default RecommendedSpecialFilters;
