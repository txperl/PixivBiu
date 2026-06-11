import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import ListLoadingOverlay from "@/components/list-loading-overlay";
import { useFilterPanel } from "@/features/activity-bar";
import { useIllustSelection } from "@/features/downloads";
import { FilteredEmpty, useFilteredIllusts } from "@/features/filter";
import {
    DEFAULT_RANKING_MODE,
    isRankingMode,
    modeFor,
    periodOf,
    RANKING_PAGE_SIZE,
    type RankingMode,
    type RankingPeriod,
    type RankingVariantKey,
    rankingQueryOptions,
    variantKeyOf,
} from "@/features/ranking/api";
import RankingDatePicker from "@/features/ranking/components/ranking-date-picker";
import RankingFilters from "@/features/ranking/components/ranking-filters";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
import SearchPager from "@/features/search/components/search-pager";
import { SearchError } from "@/features/search/components/search-states";
import { useMessages } from "@/i18n";
import { scrollAppToTop } from "@/lib/scroll";
import { patchParams, readPage } from "@/lib/url-params";

function readMode(sp: URLSearchParams): RankingMode {
    const v = sp.get("mode");
    return isRankingMode(v) ? v : DEFAULT_RANKING_MODE;
}

function readDate(sp: URLSearchParams): string | undefined {
    const v = sp.get("date");
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

function RankingEmpty({ date }: { date?: string }) {
    const m = useMessages();
    return (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="font-medium text-foreground text-lg">
                {date ? m.ranking_empty_dated({ date }) : m.ranking_empty()}
            </div>
            <div className="text-muted-foreground text-sm">{m.ranking_empty_hint()}</div>
        </div>
    );
}

function RankingPage() {
    const m = useMessages();
    const [searchParams, setSearchParams] = useSearchParams();

    const mode = readMode(searchParams);
    const date = readDate(searchParams);
    const page = readPage(searchParams);
    const period = periodOf(mode);
    const variantKey = variantKeyOf(mode);
    const offset = (page - 1) * RANKING_PAGE_SIZE;

    // The factory bakes in keepPreviousPage, so a page jump keeps the prior page on screen
    // (no skeleton flash) while a mode/date change correctly shows a skeleton for the new
    // list. The skeleton (isPending) otherwise shows only on the first load with an empty
    // cache; returning within gcTime renders cached data instantly, then revalidates.
    const { data, isPending, isError, error, isPlaceholderData } = useQuery(
        rankingQueryOptions({ mode, date, offset }),
    );

    const { selected, toggle, replaceSelection, clearSelection } = useIllustSelection();

    // Reset selection whenever the list identity (mode/date/page) changes — the
    // previous list's selection must not bleed across a navigation. Replaces the
    // clearSelection() that used to live in the now-gone fetch effect. mode/date/
    // page are intentional re-run triggers (the effect body doesn't read them).
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on navigation, not on body deps.
    useEffect(() => {
        clearSelection();
    }, [mode, date, page, clearSelection]);

    const { filtered, totalBefore, totalAfter } = useFilteredIllusts(data?.illusts);
    const currentIllustIds = useMemo(() => filtered.map((il) => il.id), [filtered]);
    useFilterPanel({
        specialFilters: null,
        specialFiltersActiveCount: 0,
        onResetSpecialFilters: null,
        totalBefore,
        totalAfter,
        quickAction: {
            selected,
            allIllustIds: currentIllustIds,
            onReplaceSelection: replaceSelection,
            onClearSelection: clearSelection,
        },
    });

    const updateParams = (patch: Record<string, string | undefined>, resetPage = false) => {
        setSearchParams(patchParams(searchParams, patch, resetPage));
    };

    const onPeriodChange = (nextPeriod: RankingPeriod) => {
        const nextMode = modeFor(nextPeriod, variantKey);
        updateParams({ mode: nextMode === DEFAULT_RANKING_MODE ? undefined : nextMode }, true);
    };

    const onVariantChange = (nextVariantKey: RankingVariantKey) => {
        const nextMode = modeFor(period, nextVariantKey);
        updateParams({ mode: nextMode === DEFAULT_RANKING_MODE ? undefined : nextMode }, true);
    };

    const onDateChange = (nextDate: string | undefined) => {
        updateParams({ date: nextDate }, true);
    };

    const onJumpPage = (p: number) => {
        updateParams({ page: p === 1 ? undefined : String(p) });
        scrollAppToTop();
    };

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-7 pb-7">
            <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h1 className="font-semibold text-5xl text-foreground">{m.ranking_title()}</h1>
                <RankingDatePicker date={date} onDateChange={onDateChange} />
            </header>

            <RankingFilters
                period={period}
                variantKey={variantKey}
                onPeriodChange={onPeriodChange}
                onVariantChange={onVariantChange}
            />

            <ListLoadingOverlay active={isPlaceholderData}>
                {isPending ? (
                    <IllustGridSkeleton />
                ) : isError ? (
                    <SearchError error={error} />
                ) : data.illusts.length === 0 ? (
                    <RankingEmpty date={date} />
                ) : filtered.length === 0 ? (
                    <FilteredEmpty totalBefore={totalBefore} />
                ) : (
                    <IllustGrid illusts={filtered} selected={selected} onToggle={toggle} />
                )}
            </ListLoadingOverlay>

            {!isPending && !isError && data.illusts.length > 0 && (
                <SearchPager currentPage={page} hasNext={data.next_offset != null} onJump={onJumpPage} />
            )}
        </div>
    );
}

export default RankingPage;
