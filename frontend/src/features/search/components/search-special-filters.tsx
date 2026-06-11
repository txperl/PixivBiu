import { format, parse, startOfToday } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FilterRow from "@/features/filter/components/filter-row";
import Segmented from "@/features/filter/components/segmented";
import {
    DEFAULT_SEARCH_SORT,
    DEFAULT_SEARCH_TARGET,
    SEARCH_DURATIONS,
    SEARCH_ILLUST_SORTS,
    SEARCH_SORTS,
    SEARCH_TARGETS,
    type SearchDuration,
    type SearchSort,
    type SearchTarget,
} from "@/features/search/api";
import { useMessages } from "@/i18n";

type Messages = ReturnType<typeof useMessages>;

function targetLabel(m: Messages, target: SearchTarget): string {
    switch (target) {
        case "partial_match_for_tags":
            return m.search_target_partial_match_for_tags();
        case "exact_match_for_tags":
            return m.search_target_exact_match_for_tags();
        case "title_and_caption":
            return m.search_target_title_and_caption();
        case "keyword":
            return m.search_target_keyword();
    }
}

function sortLabel(m: Messages, sort: SearchSort): string {
    switch (sort) {
        case "date_desc":
            return m.search_sort_date_desc();
        case "date_asc":
            return m.search_sort_date_asc();
        case "popular_desc":
            return m.search_sort_popular_desc();
        case "bookmarks_desc":
            return m.search_sort_bookmarks_desc();
        case "views_desc":
            return m.search_sort_views_desc();
    }
}

function durationLabel(m: Messages, duration: SearchDuration): string {
    switch (duration) {
        case "within_last_day":
            return m.search_duration_within_last_day();
        case "within_last_week":
            return m.search_duration_within_last_week();
        case "within_last_month":
            return m.search_duration_within_last_month();
    }
}

const DATE_FORMAT = "yyyy-MM-dd";

function parseDate(s: string | undefined): Date | undefined {
    if (!s) return undefined;
    const d = parse(s, DATE_FORMAT, new Date());
    return Number.isNaN(d.getTime()) ? undefined : d;
}

function DatePickerField({
    label,
    value,
    onChange,
    placeholder,
    minDate,
    maxDate,
    inactive,
}: {
    label: string;
    value?: string;
    onChange: (next: string | undefined) => void;
    placeholder: string;
    minDate?: Date;
    maxDate?: Date;
    inactive?: boolean;
}) {
    const m = useMessages();
    const selected = parseDate(value);
    return (
        <FilterRow label={label} inactive={inactive}>
            <div className="flex items-center gap-1">
                <Popover>
                    <PopoverTrigger
                        render={
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 flex-1 justify-start font-normal"
                            >
                                <span className={value ? "text-foreground" : "text-muted-foreground"}>
                                    {value ?? placeholder}
                                </span>
                            </Button>
                        }
                    />
                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            className="min-w-64"
                            mode="single"
                            selected={selected}
                            defaultMonth={selected ?? startOfToday()}
                            onSelect={(next) => onChange(next ? format(next, DATE_FORMAT) : undefined)}
                            disabled={[
                                ...(minDate ? [{ before: minDate }] : []),
                                ...(maxDate ? [{ after: maxDate }] : []),
                            ]}
                        />
                    </PopoverContent>
                </Popover>
                {value && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={m.search_filter_date_clear()}
                        onClick={() => onChange(undefined)}
                    >
                        ×
                    </Button>
                )}
            </div>
        </FilterRow>
    );
}

function LabeledSelect<T extends string>({
    label,
    value,
    options,
    onChange,
    inactive,
}: {
    label: string;
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (v: T) => void;
    inactive?: boolean;
}) {
    return (
        <FilterRow label={label} inactive={inactive}>
            <Select
                items={options}
                value={value}
                onValueChange={(v) => {
                    if (typeof v === "string") onChange(v as T);
                }}
            >
                <SelectTrigger size="sm" className="w-full text-xs">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </FilterRow>
    );
}

export type SearchIllustSpecialFiltersProps = {
    target: SearchTarget;
    sort: SearchSort;
    duration: SearchDuration | undefined;
    startDate: string | undefined;
    endDate: string | undefined;
    excludeAi: boolean;
    onTargetChange: (v: SearchTarget) => void;
    onSortChange: (v: SearchSort) => void;
    onDurationChange: (v: SearchDuration | undefined) => void;
    onStartDateChange: (v: string | undefined) => void;
    onEndDateChange: (v: string | undefined) => void;
    onExcludeAiChange: (v: boolean) => void;
};

export function SearchIllustSpecialFilters(props: SearchIllustSpecialFiltersProps) {
    const m = useMessages();
    const targetItems = SEARCH_TARGETS.map((t) => ({ value: t, label: targetLabel(m, t) }));
    const sortItems = SEARCH_ILLUST_SORTS.map((s) => ({ value: s, label: sortLabel(m, s) }));
    const durationItems = [
        { value: "__any__", label: m.search_duration_any() },
        ...SEARCH_DURATIONS.map((d) => ({ value: d, label: durationLabel(m, d) })),
    ] as const;
    const endMin = props.startDate ? parseDate(props.startDate) : undefined;
    const startMax = props.endDate ? parseDate(props.endDate) : undefined;

    return (
        <div className="flex flex-col gap-3">
            <LabeledSelect
                label={m.search_filter_match()}
                value={props.target}
                options={targetItems}
                onChange={props.onTargetChange}
                inactive={props.target === DEFAULT_SEARCH_TARGET}
            />
            <LabeledSelect
                label={m.search_filter_sort()}
                value={props.sort}
                options={sortItems}
                onChange={props.onSortChange}
                inactive={props.sort === DEFAULT_SEARCH_SORT}
            />
            <LabeledSelect
                label={m.search_filter_time_window()}
                value={props.duration ?? "__any__"}
                options={durationItems}
                onChange={(v) => props.onDurationChange(v === "__any__" ? undefined : (v as SearchDuration))}
                inactive={props.duration === undefined}
            />
            <DatePickerField
                label={m.search_filter_start_date()}
                value={props.startDate}
                onChange={props.onStartDateChange}
                placeholder={m.search_filter_date_any()}
                maxDate={startMax}
                inactive={props.startDate === undefined}
            />
            <DatePickerField
                label={m.search_filter_end_date()}
                value={props.endDate}
                onChange={props.onEndDateChange}
                placeholder={m.search_filter_date_any()}
                minDate={endMin}
                inactive={props.endDate === undefined}
            />
            <FilterRow label={m.search_filter_ai()} inactive={!props.excludeAi}>
                <Segmented
                    value={props.excludeAi ? "exclude" : "any"}
                    options={[
                        { value: "any", label: m.search_ai_include() },
                        { value: "exclude", label: m.search_ai_exclude() },
                    ]}
                    onChange={(v) => props.onExcludeAiChange(v === "exclude")}
                />
            </FilterRow>
        </div>
    );
}

export type SearchUserSpecialFiltersProps = {
    sort: SearchSort;
    duration: SearchDuration | undefined;
    onSortChange: (v: SearchSort) => void;
    onDurationChange: (v: SearchDuration | undefined) => void;
};

export function SearchUserSpecialFilters(props: SearchUserSpecialFiltersProps) {
    const m = useMessages();
    const sortItems = SEARCH_SORTS.map((s) => ({ value: s, label: sortLabel(m, s) }));
    const durationItems = [
        { value: "__any__", label: m.search_duration_any() },
        ...SEARCH_DURATIONS.map((d) => ({ value: d, label: durationLabel(m, d) })),
    ] as const;
    return (
        <div className="flex flex-col gap-3">
            <LabeledSelect
                label={m.search_filter_sort()}
                value={props.sort}
                options={sortItems}
                onChange={props.onSortChange}
                inactive={props.sort === DEFAULT_SEARCH_SORT}
            />
            <LabeledSelect
                label={m.search_filter_time_window()}
                value={props.duration ?? "__any__"}
                options={durationItems}
                onChange={(v) => props.onDurationChange(v === "__any__" ? undefined : (v as SearchDuration))}
                inactive={props.duration === undefined}
            />
        </div>
    );
}
