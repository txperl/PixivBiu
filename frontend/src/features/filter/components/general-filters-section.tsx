import { useMessages } from "@/i18n";
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

type Messages = ReturnType<typeof useMessages>;

// Formats a threshold value into a localized label. 0 means no minimum; large
// values are abbreviated and routed through message keys so each locale keeps
// its own unit convention (e.g. "k" in en, the 10k-unit in zh/ja).
function formatCount(m: Messages, v: number): string {
    if (v === 0) return m.common_unlimited();
    if (v >= 10000) return m.filter_threshold_wan({ n: v / 10000 });
    if (v >= 1000) return m.filter_threshold_k({ n: v / 1000 });
    return m.filter_threshold_ge({ n: v });
}

function GeneralFiltersSection() {
    const m = useMessages();
    const { filters, setFilters } = useGeneralFilters();
    const active = getGeneralFilterFlags(filters);

    const xRestrictOpts: ReadonlyArray<ChipOption<XRestrictKey>> = [
        { value: "safe", label: m.common_rating_safe() },
        { value: "r18", label: "R-18" },
        { value: "r18g", label: "R-18G" },
    ];

    const illustTypeOpts: ReadonlyArray<ChipOption<IllustTypeKey>> = [
        { value: "illust", label: m.common_illust() },
        { value: "manga", label: m.common_manga() },
        { value: "ugoira", label: m.common_ugoira() },
    ];

    const aspectOpts: ReadonlyArray<ChipOption<AspectRatio>> = [
        { value: "landscape", label: m.filter_aspect_landscape() },
        { value: "portrait", label: m.filter_aspect_portrait() },
        { value: "square", label: m.filter_aspect_square() },
    ];

    const aiOpts: ReadonlyArray<SegmentedOption<AiFilter>> = [
        { value: "any", label: m.common_unlimited() },
        { value: "exclude", label: m.filter_ai_exclude() },
        { value: "only", label: m.filter_ai_only() },
    ];

    const pageCountOpts: ReadonlyArray<SegmentedOption<PageCountFilter>> = [
        { value: "any", label: m.common_unlimited() },
        { value: "single", label: m.filter_page_count_single() },
        { value: "multi", label: m.filter_page_count_multi() },
    ];

    const bookmarkedOpts: ReadonlyArray<SegmentedOption<BookmarkedFilter>> = [
        { value: "any", label: m.common_unlimited() },
        { value: "only", label: m.filter_bookmarked_only() },
        { value: "exclude", label: m.filter_bookmarked_exclude() },
    ];

    const formatThreshold = (v: number) => formatCount(m, v);

    return (
        <div className="flex flex-col gap-3.5">
            <FilterRow label={m.filter_x_restrict_label()} inactive={!active.xRestrict}>
                <CheckChipGroup
                    values={filters.xRestrict}
                    options={xRestrictOpts}
                    onChange={(v) => setFilters({ xRestrict: v })}
                />
            </FilterRow>

            <FilterRow label={m.filter_ai_label()} inactive={!active.ai}>
                <Segmented value={filters.ai} options={aiOpts} onChange={(v) => setFilters({ ai: v })} />
            </FilterRow>

            <FilterRow label={m.filter_illust_type_label()} inactive={!active.illustType}>
                <CheckChipGroup
                    values={filters.illustType}
                    options={illustTypeOpts}
                    onChange={(v) => setFilters({ illustType: v })}
                />
            </FilterRow>

            <div className="grid grid-cols-2 gap-3">
                <FilterRow label={m.filter_min_bookmarks_label()} inactive={!active.minBookmarks}>
                    <ThresholdSelect
                        value={filters.minBookmarks}
                        options={MIN_BOOKMARKS_TIERS}
                        formatOption={formatThreshold}
                        onChange={(v) => setFilters({ minBookmarks: v })}
                    />
                </FilterRow>
                <FilterRow label={m.filter_min_views_label()} inactive={!active.minViews}>
                    <ThresholdSelect
                        value={filters.minViews}
                        options={MIN_VIEWS_TIERS}
                        formatOption={formatThreshold}
                        onChange={(v) => setFilters({ minViews: v })}
                    />
                </FilterRow>
            </div>

            <FilterRow label={m.filter_page_count_label()} inactive={!active.pageCount}>
                <Segmented
                    value={filters.pageCount}
                    options={pageCountOpts}
                    onChange={(v) => setFilters({ pageCount: v })}
                />
            </FilterRow>

            <FilterRow label={m.filter_aspect_label()} inactive={!active.aspectRatio}>
                <CheckChipGroup
                    values={filters.aspectRatio}
                    options={aspectOpts}
                    onChange={(v) => setFilters({ aspectRatio: v })}
                />
            </FilterRow>

            <FilterRow label={m.filter_bookmarked_label()} inactive={!active.bookmarked}>
                <Segmented
                    value={filters.bookmarked}
                    options={bookmarkedOpts}
                    onChange={(v) => setFilters({ bookmarked: v })}
                />
            </FilterRow>

            <TagInput
                label={m.filter_include_tags_label()}
                placeholder={m.filter_tag_placeholder()}
                values={filters.includeTags}
                onChange={(v) => setFilters({ includeTags: v })}
                inactive={!active.includeTags}
            />

            <TagInput
                label={m.filter_exclude_tags_label()}
                placeholder={m.filter_tag_placeholder()}
                values={filters.excludeTags}
                onChange={(v) => setFilters({ excludeTags: v })}
                inactive={!active.excludeTags}
            />
        </div>
    );
}

export default GeneralFiltersSection;
