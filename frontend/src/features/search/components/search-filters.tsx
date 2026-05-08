import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SEARCH_SORTS, SEARCH_TARGETS, type SearchSort, type SearchTarget } from "@/features/search/api";

const TARGET_LABELS: Record<SearchTarget, string> = {
    partial_match_for_tags: "标签部分匹配",
    exact_match_for_tags: "标签完全匹配",
    title_and_caption: "标题与描述",
    keyword: "关键词",
};

const SORT_LABELS: Record<SearchSort, string> = {
    date_desc: "最新发布",
    date_asc: "最早发布",
    popular_desc: "人气降序（仅 Premium）",
};

type SearchFiltersProps = {
    target: SearchTarget;
    sort: SearchSort;
    onTargetChange: (next: SearchTarget) => void;
    onSortChange: (next: SearchSort) => void;
};

function SearchFilters({ target, sort, onTargetChange, onSortChange }: SearchFiltersProps) {
    const targetItems = SEARCH_TARGETS.map((t) => ({ label: TARGET_LABELS[t], value: t }));
    const sortItems = SEARCH_SORTS.map((s) => ({ label: SORT_LABELS[s], value: s }));

    return (
        <div className="flex flex-wrap items-center gap-2">
            <Select items={targetItems} value={target} onValueChange={(v) => v && onTargetChange(v)}>
                <SelectTrigger className="h-8">
                    <SelectValue placeholder="匹配方式" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {targetItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                                {item.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>

            <Select items={sortItems} value={sort} onValueChange={(v) => v && onSortChange(v)}>
                <SelectTrigger className="h-8">
                    <SelectValue placeholder="排序" />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {sortItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                                {item.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
    );
}

export default SearchFilters;
