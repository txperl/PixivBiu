import { format, parse, startOfToday } from "date-fns";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Segmented from "@/features/filter/components/segmented";
import {
    SEARCH_DURATIONS,
    SEARCH_SORTS,
    SEARCH_TARGETS,
    type SearchDuration,
    type SearchSort,
    type SearchTarget,
} from "@/features/search/api";

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

const DURATION_LABELS: Record<SearchDuration, string> = {
    within_last_day: "近一天",
    within_last_week: "近一周",
    within_last_month: "近一月",
};

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
}: {
    label: string;
    value?: string;
    onChange: (next: string | undefined) => void;
    placeholder: string;
    minDate?: Date;
    maxDate?: Date;
}) {
    const selected = parseDate(value);
    return (
        <div className="flex flex-col gap-1.5">
            <div className="text-muted-foreground text-xs">{label}</div>
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
                        aria-label="清除"
                        onClick={() => onChange(undefined)}
                    >
                        ×
                    </Button>
                )}
            </div>
        </div>
    );
}

function LabeledSelect<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (v: T) => void;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="text-muted-foreground text-xs">{label}</div>
            <Select
                items={options}
                value={value}
                onValueChange={(v) => {
                    if (typeof v === "string") onChange(v as T);
                }}
            >
                <SelectTrigger className="h-8 w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
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
    const targetItems = SEARCH_TARGETS.map((t) => ({ value: t, label: TARGET_LABELS[t] }));
    const sortItems = SEARCH_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }));
    const durationItems = [
        { value: "__any__", label: "全部时间" },
        ...SEARCH_DURATIONS.map((d) => ({ value: d, label: DURATION_LABELS[d] })),
    ] as const;
    const endMin = props.startDate ? parseDate(props.startDate) : undefined;
    const startMax = props.endDate ? parseDate(props.endDate) : undefined;

    return (
        <div className="flex flex-col gap-3">
            <LabeledSelect
                label="匹配方式"
                value={props.target}
                options={targetItems}
                onChange={props.onTargetChange}
            />
            <LabeledSelect label="排序" value={props.sort} options={sortItems} onChange={props.onSortChange} />
            <LabeledSelect
                label="时间窗"
                value={props.duration ?? "__any__"}
                options={durationItems}
                onChange={(v) => props.onDurationChange(v === "__any__" ? undefined : (v as SearchDuration))}
            />
            <DatePickerField
                label="发布起"
                value={props.startDate}
                onChange={props.onStartDateChange}
                placeholder="不限"
                maxDate={startMax}
            />
            <DatePickerField
                label="发布止"
                value={props.endDate}
                onChange={props.onEndDateChange}
                placeholder="不限"
                minDate={endMin}
            />
            <div className="flex flex-col gap-1.5">
                <div className="text-muted-foreground text-xs">AI 作品</div>
                <Segmented
                    value={props.excludeAi ? "exclude" : "any"}
                    options={[
                        { value: "any", label: "包含" },
                        { value: "exclude", label: "排除 AI" },
                    ]}
                    onChange={(v) => props.onExcludeAiChange(v === "exclude")}
                />
            </div>
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
    const sortItems = SEARCH_SORTS.map((s) => ({ value: s, label: SORT_LABELS[s] }));
    const durationItems = [
        { value: "__any__", label: "全部时间" },
        ...SEARCH_DURATIONS.map((d) => ({ value: d, label: DURATION_LABELS[d] })),
    ] as const;
    return (
        <div className="flex flex-col gap-3">
            <LabeledSelect label="排序" value={props.sort} options={sortItems} onChange={props.onSortChange} />
            <LabeledSelect
                label="时间窗"
                value={props.duration ?? "__any__"}
                options={durationItems}
                onChange={(v) => props.onDurationChange(v === "__any__" ? undefined : (v as SearchDuration))}
            />
        </div>
    );
}
