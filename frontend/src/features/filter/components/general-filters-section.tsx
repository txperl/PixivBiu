import { useGeneralFilters } from "../hooks";
import {
    type AiFilter,
    type AspectRatio,
    type BookmarkedFilter,
    getGeneralFilterFlags,
    type IllustTypeKey,
    MIN_BOOKMARKS_TIERS,
    MIN_VIEWS_TIERS,
    type PageCountFilter,
    type XRestrictKey,
} from "../types";
import CheckChipGroup, { type ChipOption } from "./check-chip-group";
import FilterRow from "./filter-row";
import Segmented, { type SegmentedOption } from "./segmented";
import TagInput from "./tag-input";
import ThresholdSelect from "./threshold-select";

const X_RESTRICT_OPTS: ReadonlyArray<ChipOption<XRestrictKey>> = [
    { value: "safe", label: "普通" },
    { value: "r18", label: "R-18" },
    { value: "r18g", label: "R-18G" },
];

const ILLUST_TYPE_OPTS: ReadonlyArray<ChipOption<IllustTypeKey>> = [
    { value: "illust", label: "插画" },
    { value: "manga", label: "漫画" },
    { value: "ugoira", label: "动图" },
];

const ASPECT_OPTS: ReadonlyArray<ChipOption<AspectRatio>> = [
    { value: "landscape", label: "横" },
    { value: "portrait", label: "竖" },
    { value: "square", label: "方" },
];

const AI_OPTS: ReadonlyArray<SegmentedOption<AiFilter>> = [
    { value: "any", label: "不限" },
    { value: "exclude", label: "排除" },
    { value: "only", label: "仅 AI" },
];

const PAGE_COUNT_OPTS: ReadonlyArray<SegmentedOption<PageCountFilter>> = [
    { value: "any", label: "不限" },
    { value: "single", label: "单张" },
    { value: "multi", label: "多张" },
];

const BOOKMARKED_OPTS: ReadonlyArray<SegmentedOption<BookmarkedFilter>> = [
    { value: "any", label: "不限" },
    { value: "only", label: "仅已收藏" },
    { value: "exclude", label: "排除已收藏" },
];

function formatCount(v: number): string {
    if (v === 0) return "不限";
    if (v >= 10000) return `≥${v / 10000}万`;
    if (v >= 1000) return `≥${v / 1000}k`;
    return `≥${v}`;
}

function GeneralFiltersSection() {
    const { filters, setFilters } = useGeneralFilters();
    const active = getGeneralFilterFlags(filters);

    return (
        <div className="flex flex-col gap-3.5">
            <FilterRow label="分级" inactive={!active.xRestrict}>
                <CheckChipGroup
                    values={filters.xRestrict}
                    options={X_RESTRICT_OPTS}
                    onChange={(v) => setFilters({ xRestrict: v })}
                />
            </FilterRow>

            <FilterRow label="AI 作品" inactive={!active.ai}>
                <Segmented value={filters.ai} options={AI_OPTS} onChange={(v) => setFilters({ ai: v })} />
            </FilterRow>

            <FilterRow label="作品类型" inactive={!active.illustType}>
                <CheckChipGroup
                    values={filters.illustType}
                    options={ILLUST_TYPE_OPTS}
                    onChange={(v) => setFilters({ illustType: v })}
                />
            </FilterRow>

            <div className="grid grid-cols-2 gap-3">
                <FilterRow label="最低收藏" inactive={!active.minBookmarks}>
                    <ThresholdSelect
                        value={filters.minBookmarks}
                        options={MIN_BOOKMARKS_TIERS}
                        formatOption={formatCount}
                        onChange={(v) => setFilters({ minBookmarks: v })}
                    />
                </FilterRow>
                <FilterRow label="最低浏览" inactive={!active.minViews}>
                    <ThresholdSelect
                        value={filters.minViews}
                        options={MIN_VIEWS_TIERS}
                        formatOption={formatCount}
                        onChange={(v) => setFilters({ minViews: v })}
                    />
                </FilterRow>
            </div>

            <FilterRow label="页数" inactive={!active.pageCount}>
                <Segmented
                    value={filters.pageCount}
                    options={PAGE_COUNT_OPTS}
                    onChange={(v) => setFilters({ pageCount: v })}
                />
            </FilterRow>

            <FilterRow label="纵横比" inactive={!active.aspectRatio}>
                <CheckChipGroup
                    values={filters.aspectRatio}
                    options={ASPECT_OPTS}
                    onChange={(v) => setFilters({ aspectRatio: v })}
                />
            </FilterRow>

            <FilterRow label="收藏状态" inactive={!active.bookmarked}>
                <Segmented
                    value={filters.bookmarked}
                    options={BOOKMARKED_OPTS}
                    onChange={(v) => setFilters({ bookmarked: v })}
                />
            </FilterRow>

            <TagInput
                label="标签包含（任一命中）"
                placeholder="输入后回车 / 逗号添加"
                values={filters.includeTags}
                onChange={(v) => setFilters({ includeTags: v })}
                inactive={!active.includeTags}
            />

            <TagInput
                label="标签排除（任一命中）"
                placeholder="输入后回车 / 逗号添加"
                values={filters.excludeTags}
                onChange={(v) => setFilters({ excludeTags: v })}
                inactive={!active.excludeTags}
            />
        </div>
    );
}

export default GeneralFiltersSection;
