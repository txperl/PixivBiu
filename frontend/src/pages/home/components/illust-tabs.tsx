import { HugeiconsIcon } from "@hugeicons/react";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterPanel } from "@/features/activity-bar";
import { useIllustSelection } from "@/features/downloads";
import { FilteredEmpty, useFilteredIllusts } from "@/features/filter";
import {
    followingInfiniteQueryOptions,
    type IllustType,
    type Restrict,
    recommendedInfiniteQueryOptions,
} from "@/features/illusts/api";
import FollowingSpecialFilters from "@/features/illusts/components/following-special-filters";
import RecommendedSpecialFilters from "@/features/illusts/components/recommended-special-filters";
import { weekRankingInfiniteQueryOptions } from "@/features/ranking/api";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
import { SearchError } from "@/features/search/components/search-states";
import { useMessages } from "@/i18n";
import { RefreshIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

export type TabId = "for-you" | "week" | "follow";

type ForYouParams = { type: IllustType | undefined; includeRankingIllusts: boolean };
type FollowParams = { restrict: Restrict };

const TAB_IDS: ReadonlyArray<TabId> = ["for-you", "week", "follow"];

const DEFAULT_FOR_YOU: ForYouParams = { type: undefined, includeRankingIllusts: true };
const DEFAULT_FOLLOW: FollowParams = { restrict: "public" };

function countForYouActive(p: ForYouParams): number {
    let n = 0;
    if (p.type !== DEFAULT_FOR_YOU.type) n++;
    if (p.includeRankingIllusts !== DEFAULT_FOR_YOU.includeRankingIllusts) n++;
    return n;
}

function countFollowActive(p: FollowParams): number {
    return p.restrict !== DEFAULT_FOLLOW.restrict ? 1 : 0;
}

type Messages = ReturnType<typeof useMessages>;

function tabLabel(m: Messages, id: TabId): string {
    switch (id) {
        case "for-you":
            return m.home_tab_for_you();
        case "week":
            return m.home_tab_week();
        case "follow":
            return m.home_tab_follow();
    }
}

type HomeIllustTabsProps = {
    activeTab: TabId;
    onActiveTabChange: (id: TabId) => void;
};

function HomeIllustTabs({ activeTab, onActiveTabChange }: HomeIllustTabsProps) {
    const m = useMessages();
    const queryClient = useQueryClient();
    const { selected, toggle, replaceSelection, clearSelection } = useIllustSelection();
    const [forYou, setForYou] = useState<ForYouParams>(DEFAULT_FOR_YOU);
    const [follow, setFollow] = useState<FollowParams>(DEFAULT_FOLLOW);

    // One infinite query per tab; only the active tab fetches (`enabled`). Inactive tabs
    // keep their accumulated pages in cache (gcTime), so re-selecting a tab or returning to
    // home shows its content instantly instead of re-pulling. keepPreviousData keeps the
    // grid on screen while a same-tab filter change reloads (matching the old refresh-over-
    // grid). A tab switch reads a different query, so each tab shows its own cache/skeleton
    // with no cross-tab bleed. TanStack handles dedup/races, replacing the old version refs.
    const forYouOptions = recommendedInfiniteQueryOptions({
        type: forYou.type,
        includeRankingIllusts: forYou.includeRankingIllusts,
    });
    const weekOptions = weekRankingInfiniteQueryOptions();
    const followOptions = followingInfiniteQueryOptions({ restrict: follow.restrict });

    const forYouQuery = useInfiniteQuery({
        ...forYouOptions,
        enabled: activeTab === "for-you",
        placeholderData: keepPreviousData,
    });
    const weekQuery = useInfiniteQuery({
        ...weekOptions,
        enabled: activeTab === "week",
        placeholderData: keepPreviousData,
    });
    const followQuery = useInfiniteQuery({
        ...followOptions,
        enabled: activeTab === "follow",
        placeholderData: keepPreviousData,
    });

    // Pick the active tab's query + options from a map instead of parallel ternaries; all
    // three hooks stay mounted above, only the active one is enabled.
    const byTab = {
        "for-you": { options: forYouOptions, query: forYouQuery },
        week: { options: weekOptions, query: weekQuery },
        follow: { options: followOptions, query: followQuery },
    };
    const { options: activeOptions, query } = byTab[activeTab];

    const illusts = useMemo(() => query.data?.pages.flatMap((p) => p.illusts) ?? [], [query.data?.pages]);
    const { filtered, totalBefore, totalAfter } = useFilteredIllusts(illusts);
    const currentIllustIds = useMemo(() => filtered.map((il) => il.id), [filtered]);

    const specialFilters: ReactNode | null = useMemo(() => {
        if (activeTab === "for-you") {
            return (
                <RecommendedSpecialFilters
                    type={forYou.type}
                    includeRankingIllusts={forYou.includeRankingIllusts}
                    onTypeChange={(v) => setForYou((p) => ({ ...p, type: v }))}
                    onIncludeRankingChange={(v) => setForYou((p) => ({ ...p, includeRankingIllusts: v }))}
                />
            );
        }
        if (activeTab === "follow") {
            return (
                <FollowingSpecialFilters
                    restrict={follow.restrict}
                    onRestrictChange={(v) => setFollow({ restrict: v })}
                />
            );
        }
        return null;
    }, [activeTab, forYou.type, forYou.includeRankingIllusts, follow.restrict]);

    const specialFiltersActiveCount =
        activeTab === "for-you" ? countForYouActive(forYou) : activeTab === "follow" ? countFollowActive(follow) : 0;

    const resetSpecialFilters = useCallback(() => {
        if (activeTab === "for-you") setForYou(DEFAULT_FOR_YOU);
        else if (activeTab === "follow") setFollow(DEFAULT_FOLLOW);
    }, [activeTab]);

    useFilterPanel({
        specialFilters,
        specialFiltersActiveCount,
        onResetSpecialFilters: resetSpecialFilters,
        totalBefore,
        totalAfter,
        quickAction: {
            selected,
            allIllustIds: currentIllustIds,
            onReplaceSelection: replaceSelection,
            onClearSelection: clearSelection,
        },
    });

    const handleTabChange = (v: string) => {
        if (v === activeTab) return;
        clearSelection();
        onActiveTabChange(v as TabId);
    };

    // Refresh: drop the active tab to page 1 and refetch fresh (replaces the old replaceAll).
    const handleRefresh = () => {
        if (query.isFetching) return;
        queryClient.resetQueries({ queryKey: activeOptions.queryKey });
    };

    // Spin the refresh icon on an initial/refresh fetch, but not while loading more (the
    // load-more button shows its own spinner) — matching the previous behavior.
    const refreshSpinning = query.isFetching && !query.isFetchingNextPage;

    return (
        <section>
            <div className="mb-4 flex items-center border-muted/60 border-b">
                <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1">
                    <TabsList variant="line" className="h-12 gap-0">
                        {TAB_IDS.map((id) => (
                            <TabsTrigger
                                key={id}
                                value={id}
                                className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                            >
                                {tabLabel(m, id)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                <div className="pb-1.5">
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleRefresh}
                        disabled={query.isFetching}
                        aria-label={m.common_refresh()}
                    >
                        <HugeiconsIcon
                            icon={RefreshIcon}
                            strokeWidth={2.5}
                            className={cn(refreshSpinning && "animate-spin")}
                        />
                    </Button>
                </div>
            </div>

            {query.isPending ? (
                <IllustGridSkeleton />
            ) : query.isError && illusts.length === 0 ? (
                // Only take over the page when the FIRST load failed (nothing to show). A
                // later fetchNextPage() error keeps query.data (the loaded pages) populated
                // while flipping isError — fall through so the feed stays visible and the
                // load-more button returns to a retry state instead of the feed vanishing.
                <SearchError error={query.error} />
            ) : illusts.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-20 text-center">
                    <div className="font-medium text-foreground text-lg">{m.common_no_data()}</div>
                </div>
            ) : filtered.length === 0 ? (
                <FilteredEmpty totalBefore={totalBefore} />
            ) : (
                <>
                    <IllustGrid illusts={filtered} selected={selected} onToggle={toggle} />
                    {query.hasNextPage && (
                        <div className="flex justify-end pt-6 pb-2">
                            <button
                                type="button"
                                className="font-semibold text-4xl text-muted-foreground hover:underline"
                                onClick={() => query.fetchNextPage()}
                                // Disable during ANY active fetch, not just next-page fetches: a load-more
                                // click while the feed is refetching (stale revalidation / invalidation /
                                // refresh) would overlap that refresh and append from the stale pages' offset.
                                disabled={query.isFetching}
                            >
                                {query.isFetchingNextPage ? (
                                    <LeapyLoading className="px-3" size={16} />
                                ) : (
                                    m.common_load_more()
                                )}
                            </button>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

export default HomeIllustTabs;
