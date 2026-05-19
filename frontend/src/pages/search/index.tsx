import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterPanel, useQuickActionPanel } from "@/features/activity-bar";
import { useIllustSelection } from "@/features/downloads";
import { FilteredEmpty, useFilteredIllusts } from "@/features/filter";
import {
    DEFAULT_SEARCH_SORT,
    DEFAULT_SEARCH_TARGET,
    type IllustPage,
    SEARCH_DURATIONS,
    SEARCH_PAGE_SIZE,
    SEARCH_SORTS,
    SEARCH_TARGETS,
    type SearchDuration,
    type SearchSort,
    type SearchTarget,
    searchIllusts,
    searchUsers,
    type UserPreviewPage,
} from "@/features/search/api";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
import SearchBar from "@/features/search/components/search-bar";
import SearchPager from "@/features/search/components/search-pager";
import {
    SearchIllustSpecialFilters,
    SearchUserSpecialFilters,
} from "@/features/search/components/search-special-filters";
import { SearchEmptyState, SearchError, SearchNoResults } from "@/features/search/components/search-states";
import UserList, { UserListSkeleton } from "@/features/search/components/user-list";
import type { FetchState } from "@/lib/fetch-state";
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
    return (SEARCH_SORTS as readonly string[]).includes(v ?? "") ? (v as SearchSort) : DEFAULT_SEARCH_SORT;
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

function isIllustSpecialActive(
    target: SearchTarget,
    sort: SearchSort,
    duration: SearchDuration | undefined,
    startDate: string | undefined,
    endDate: string | undefined,
    excludeAi: boolean,
): boolean {
    return (
        target !== DEFAULT_SEARCH_TARGET ||
        sort !== DEFAULT_SEARCH_SORT ||
        duration !== undefined ||
        startDate !== undefined ||
        endDate !== undefined ||
        excludeAi
    );
}

function SearchPage() {
    const { keyword: rawKeyword } = useParams<{ keyword?: string }>();
    const [searchParams, setSearchParams] = useSearchParams();

    const keyword = rawKeyword ?? "";
    const type = readType(searchParams);
    const target = readTarget(searchParams);
    const sort = readSort(searchParams);
    const duration = readDuration(searchParams);
    const startDate = readDateParam(searchParams, "start_date");
    const endDate = readDateParam(searchParams, "end_date");
    const excludeAi = readExcludeAi(searchParams);
    const page = readPage(searchParams);

    const [illustState, setIllustState] = useState<FetchState<IllustPage>>({ status: "idle" });
    const [userState, setUserState] = useState<FetchState<UserPreviewPage>>({ status: "idle" });
    const { selected, toggle, replaceSelection, clearSelection } = useIllustSelection();

    const rawIllusts = illustState.status === "success" ? illustState.data.illusts : undefined;
    const { filtered, totalBefore, totalAfter } = useFilteredIllusts(rawIllusts);
    const currentIllustIds = useMemo(() => filtered.map((il) => il.id), [filtered]);

    useQuickActionPanel(
        type === "illust"
            ? {
                  selected,
                  allIllustIds: currentIllustIds,
                  onReplaceSelection: replaceSelection,
                  onClearSelection: clearSelection,
              }
            : null,
    );

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

    const specialFiltersActive =
        type === "illust"
            ? isIllustSpecialActive(target, sort, duration, startDate, endDate, excludeAi)
            : sort !== DEFAULT_SEARCH_SORT || duration !== undefined;

    useFilterPanel({
        specialFilters,
        specialFiltersActive,
        totalBefore: type === "illust" ? totalBefore : 0,
        totalAfter: type === "illust" ? totalAfter : 0,
    });

    useEffect(() => {
        clearSelection();
        if (!keyword) {
            setIllustState({ status: "idle" });
            setUserState({ status: "idle" });
            return;
        }
        let cancelled = false;
        const offset = (page - 1) * SEARCH_PAGE_SIZE;
        if (type === "illust") {
            setIllustState({ status: "loading" });
            searchIllusts({
                word: keyword,
                searchTarget: target,
                sort,
                duration,
                startDate,
                endDate,
                excludeAi: excludeAi || undefined,
                offset,
            }).then(({ data, error }) => {
                if (cancelled) return;
                if (error) setIllustState({ status: "error", error });
                else if (data) setIllustState({ status: "success", data });
            });
        } else {
            setUserState({ status: "loading" });
            searchUsers({ word: keyword, sort, duration, offset }).then(({ data, error }) => {
                if (cancelled) return;
                if (error) setUserState({ status: "error", error });
                else if (data) setUserState({ status: "success", data });
            });
        }
        return () => {
            cancelled = true;
        };
    }, [keyword, type, target, sort, duration, startDate, endDate, excludeAi, page, clearSelection]);

    const onTabChange = (v: string) => {
        if (v !== "illust" && v !== "user") return;
        patch({ type: v === "illust" ? undefined : "user" });
    };

    const onJumpPage = (p: number) => {
        patch({ page: p === 1 ? undefined : String(p) }, false);
        document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
    };

    const currentResults = type === "illust" ? illustState : userState;
    const hasNext =
        currentResults.status === "success" &&
        (type === "illust"
            ? (currentResults.data as IllustPage).next_offset != null
            : (currentResults.data as UserPreviewPage).next_offset != null);
    const showResults = keyword.length > 0;

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-4 pb-7">
            <SearchBar defaultValue={keyword} autoFocus={!keyword} />

            {!showResults && <SearchEmptyState />}

            {showResults && (
                <>
                    <Tabs value={type} onValueChange={onTabChange}>
                        <div className="border-muted/60 border-b">
                            <TabsList variant="line" className="h-12 gap-0">
                                <TabsTrigger
                                    value="illust"
                                    className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                                >
                                    作品
                                </TabsTrigger>
                                <TabsTrigger
                                    value="user"
                                    className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                                >
                                    用户
                                </TabsTrigger>
                            </TabsList>
                        </div>
                    </Tabs>

                    {type === "illust" ? (
                        <>
                            {illustState.status === "loading" && <IllustGridSkeleton />}
                            {illustState.status === "error" && <SearchError error={illustState.error} />}
                            {illustState.status === "success" &&
                                (illustState.data.illusts.length === 0 ? (
                                    <SearchNoResults word={keyword} />
                                ) : filtered.length === 0 ? (
                                    <FilteredEmpty totalBefore={totalBefore} />
                                ) : (
                                    <IllustGrid illusts={filtered} selected={selected} onToggle={toggle} />
                                ))}
                        </>
                    ) : (
                        <>
                            {userState.status === "loading" && <UserListSkeleton />}
                            {userState.status === "error" && <SearchError error={userState.error} />}
                            {userState.status === "success" &&
                                (userState.data.user_previews.length === 0 ? (
                                    <SearchNoResults word={keyword} />
                                ) : (
                                    <UserList previews={userState.data.user_previews} />
                                ))}
                        </>
                    )}

                    {currentResults.status === "success" && (
                        <SearchPager currentPage={page} hasNext={hasNext} onJump={onJumpPage} />
                    )}
                </>
            )}
        </div>
    );
}

export default SearchPage;
