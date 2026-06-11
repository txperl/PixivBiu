import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import ListLoadingOverlay from "@/components/list-loading-overlay";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterPanel } from "@/features/activity-bar";
import { useIllustSelection } from "@/features/downloads";
import { FilteredEmpty, useFilteredIllusts } from "@/features/filter";
import {
    DEFAULT_SEARCH_SORT,
    DEFAULT_SEARCH_TARGET,
    isRankedSearchSort,
    SEARCH_DURATIONS,
    SEARCH_ILLUST_SORTS,
    SEARCH_PAGE_SIZE,
    SEARCH_TARGETS,
    type SearchDuration,
    type SearchSort,
    type SearchTarget,
    searchIllustsQueryOptions,
    searchUsersQueryOptions,
} from "@/features/search/api";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
import SearchPager from "@/features/search/components/search-pager";
import {
    SearchIllustSpecialFilters,
    SearchUserSpecialFilters,
} from "@/features/search/components/search-special-filters";
import { SearchError, SearchNoResults } from "@/features/search/components/search-states";
import UserList, { UserListSkeleton } from "@/features/search/components/user-list";
import { useRankedPageSize } from "@/features/search/hooks/use-ranked-page-size";
import { useSearchHistory } from "@/features/search/hooks/use-search-history";
import { useMessages } from "@/i18n";
import { scrollAppToTop } from "@/lib/scroll";
import { patchParams, readPage } from "@/lib/url-params";

type SearchType = "illust" | "user";

function readType(sp: URLSearchParams): SearchType {
    return sp.get("type") === "user" ? "user" : "illust";
}

function readTarget(sp: URLSearchParams): SearchTarget {
    const v = sp.get("target");
    return (SEARCH_TARGETS as readonly string[]).includes(v ?? "") ? (v as SearchTarget) : DEFAULT_SEARCH_TARGET;
}

function readSort(sp: URLSearchParams): SearchSort {
    const v = sp.get("sort");
    // Validate against the illust superset (includes the synthetic ranked sorts);
    // user search ignores the illust-only values server-side.
    return (SEARCH_ILLUST_SORTS as readonly string[]).includes(v ?? "") ? (v as SearchSort) : DEFAULT_SEARCH_SORT;
}

function readDuration(sp: URLSearchParams): SearchDuration | undefined {
    const v = sp.get("duration");
    return (SEARCH_DURATIONS as readonly string[]).includes(v ?? "") ? (v as SearchDuration) : undefined;
}

function readDateParam(sp: URLSearchParams, key: "start_date" | "end_date"): string | undefined {
    const v = sp.get(key);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

function readExcludeAi(sp: URLSearchParams): boolean {
    return sp.get("exclude_ai") === "1";
}

function countIllustSpecialActive(
    target: SearchTarget,
    sort: SearchSort,
    duration: SearchDuration | undefined,
    startDate: string | undefined,
    endDate: string | undefined,
    excludeAi: boolean,
): number {
    let n = 0;
    if (target !== DEFAULT_SEARCH_TARGET) n++;
    if (sort !== DEFAULT_SEARCH_SORT) n++;
    if (duration !== undefined) n++;
    if (startDate !== undefined) n++;
    if (endDate !== undefined) n++;
    if (excludeAi) n++;
    return n;
}

type SearchResultsProps = {
    keyword: string;
};

function SearchResults({ keyword }: SearchResultsProps) {
    const m = useMessages();
    const [searchParams, setSearchParams] = useSearchParams();

    const type = readType(searchParams);
    const target = readTarget(searchParams);
    // bookmarks_desc / views_desc are illust-only synthetic sorts. In user mode
    // normalize them to the default so the user query/cache key, the active-filter
    // count, and the sort control all agree; the raw URL param is left untouched so
    // it stays active when switching back to the illust tab.
    const rawSort = readSort(searchParams);
    const sort = type === "user" && isRankedSearchSort(rawSort) ? DEFAULT_SEARCH_SORT : rawSort;
    const duration = readDuration(searchParams);
    const startDate = readDateParam(searchParams, "start_date");
    const endDate = readDateParam(searchParams, "end_date");
    const excludeAi = readExcludeAi(searchParams);
    const page = readPage(searchParams);
    // bookmarks_desc / views_desc paginate in disjoint ranked windows of
    // SEARCH_PAGE_SIZE * sample.pages (the backend re-ranks each window and
    // returns the next window's offset); a normal sort uses the plain page size.
    const ranked = type === "illust" && isRankedSearchSort(sort);
    const rankedPageSize = useRankedPageSize(ranked);
    const offset = (page - 1) * (ranked ? rankedPageSize : SEARCH_PAGE_SIZE);
    // Two queries, one per mode; only the active mode fetches (`enabled`). The factories bake
    // in keepPreviousPage, so paging keeps the prior page (no skeleton flash) while a new
    // keyword/filter shows a skeleton instead of stale results.
    const illustQuery = useQuery({
        ...searchIllustsQueryOptions({
            word: keyword,
            searchTarget: target,
            sort,
            duration,
            startDate,
            endDate,
            excludeAi: excludeAi || undefined,
            offset,
        }),
        enabled: type === "illust",
    });
    const userQuery = useQuery({
        ...searchUsersQueryOptions({ word: keyword, sort, duration, offset }),
        enabled: type === "user",
    });
    const activeQuery = type === "illust" ? illustQuery : userQuery;

    const { selected, toggle, replaceSelection, clearSelection } = useIllustSelection();
    const { push: pushHistory } = useSearchHistory();

    const { filtered, totalBefore, totalAfter } = useFilteredIllusts(illustQuery.data?.illusts);
    const currentIllustIds = useMemo(() => filtered.map((il) => il.id), [filtered]);

    const patch = useCallback(
        (p: Record<string, string | undefined>, resetPage = true) =>
            setSearchParams((sp) => patchParams(sp, p, resetPage)),
        [setSearchParams],
    );

    const specialFilters = useMemo(() => {
        if (type === "illust") {
            return (
                <SearchIllustSpecialFilters
                    target={target}
                    sort={sort}
                    duration={duration}
                    startDate={startDate}
                    endDate={endDate}
                    excludeAi={excludeAi}
                    onTargetChange={(v) => patch({ target: v === DEFAULT_SEARCH_TARGET ? undefined : v })}
                    onSortChange={(v) => patch({ sort: v === DEFAULT_SEARCH_SORT ? undefined : v })}
                    onDurationChange={(v) => patch({ duration: v })}
                    onStartDateChange={(v) => patch({ start_date: v })}
                    onEndDateChange={(v) => patch({ end_date: v })}
                    onExcludeAiChange={(v) => patch({ exclude_ai: v ? "1" : undefined })}
                />
            );
        }
        return (
            <SearchUserSpecialFilters
                sort={sort}
                duration={duration}
                onSortChange={(v) => patch({ sort: v === DEFAULT_SEARCH_SORT ? undefined : v })}
                onDurationChange={(v) => patch({ duration: v })}
            />
        );
    }, [type, target, sort, duration, startDate, endDate, excludeAi, patch]);

    const specialFiltersActiveCount =
        type === "illust"
            ? countIllustSpecialActive(target, sort, duration, startDate, endDate, excludeAi)
            : (sort !== DEFAULT_SEARCH_SORT ? 1 : 0) + (duration !== undefined ? 1 : 0);

    const resetSpecialFilters = useCallback(() => {
        if (type === "illust") {
            patch({
                target: undefined,
                sort: undefined,
                duration: undefined,
                start_date: undefined,
                end_date: undefined,
                exclude_ai: undefined,
            });
        } else {
            patch({ sort: undefined, duration: undefined });
        }
    }, [type, patch]);

    useFilterPanel({
        specialFilters,
        specialFiltersActiveCount,
        onResetSpecialFilters: resetSpecialFilters,
        totalBefore: type === "illust" ? totalBefore : 0,
        totalAfter: type === "illust" ? totalAfter : 0,
        quickAction:
            type === "illust"
                ? {
                      selected,
                      allIllustIds: currentIllustIds,
                      onReplaceSelection: replaceSelection,
                      onClearSelection: clearSelection,
                  }
                : null,
    });

    // Record the keyword once the active query succeeds (v5 has no onSuccess).
    // pushHistory dedupes, so re-runs across paging are no-ops.
    useEffect(() => {
        if (activeQuery.isSuccess) pushHistory(keyword);
    }, [keyword, activeQuery.isSuccess, pushHistory]);

    // Reset selection whenever the list identity changes — the previous list's selection
    // must not bleed across a navigation. `keyword` is part of the identity (a new keyword
    // is a different result set), so it must trigger a clear like the other search params.
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on navigation, not on body deps.
    useEffect(() => {
        clearSelection();
    }, [keyword, type, target, sort, duration, startDate, endDate, excludeAi, page, clearSelection]);

    const onTabChange = (v: string) => {
        if (v !== "illust" && v !== "user") return;
        patch({ type: v === "illust" ? undefined : "user" });
    };

    const onJumpPage = (p: number) => {
        patch({ page: p === 1 ? undefined : String(p) }, false);
        scrollAppToTop();
    };

    const hasNext = activeQuery.data?.next_offset != null;

    return (
        <>
            <Tabs value={type} onValueChange={onTabChange}>
                <div className="border-muted/60 border-b">
                    <TabsList variant="line" className="h-12 gap-0">
                        <TabsTrigger
                            value="illust"
                            className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                        >
                            {m.search_results_tab_illust()}
                        </TabsTrigger>
                        <TabsTrigger
                            value="user"
                            className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                        >
                            {m.search_results_tab_user()}
                        </TabsTrigger>
                    </TabsList>
                </div>
            </Tabs>

            <ListLoadingOverlay active={activeQuery.isPlaceholderData}>
                {type === "illust" ? (
                    illustQuery.isPending ? (
                        <IllustGridSkeleton />
                    ) : illustQuery.isError ? (
                        <SearchError error={illustQuery.error} />
                    ) : illustQuery.data.illusts.length === 0 ? (
                        <SearchNoResults word={keyword} />
                    ) : filtered.length === 0 ? (
                        <FilteredEmpty totalBefore={totalBefore} />
                    ) : (
                        <IllustGrid illusts={filtered} selected={selected} onToggle={toggle} />
                    )
                ) : userQuery.isPending ? (
                    <UserListSkeleton />
                ) : userQuery.isError ? (
                    <SearchError error={userQuery.error} />
                ) : userQuery.data.user_previews.length === 0 ? (
                    <SearchNoResults word={keyword} />
                ) : (
                    <UserList previews={userQuery.data.user_previews} />
                )}
            </ListLoadingOverlay>

            {activeQuery.isSuccess && <SearchPager currentPage={page} hasNext={hasNext} onJump={onJumpPage} />}
        </>
    );
}

export default SearchResults;
