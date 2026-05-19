import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterPanel, useQuickActionPanel } from "@/features/activity-bar";
import { useIllustSelection } from "@/features/downloads";
import { FilteredEmpty, useFilteredIllusts } from "@/features/filter";
import {
    type Illust,
    type IllustApiError,
    type IllustPage,
    type IllustType,
    listFollowingIllusts,
    listRecommended,
    type Restrict,
} from "@/features/illusts/api";
import FollowingSpecialFilters from "@/features/illusts/components/following-special-filters";
import RecommendedSpecialFilters from "@/features/illusts/components/recommended-special-filters";
import { listRanking } from "@/features/ranking/api";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
import { SearchError } from "@/features/search/components/search-states";
import { RefreshIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type TabId = "for-you" | "week" | "follow";

type TabState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; error: IllustApiError }
    | {
          status: "success";
          illusts: Illust[];
          nextOffset: number | null;
          loadingMore: boolean;
          refreshing: boolean;
      };

type ForYouParams = { type: IllustType | undefined; includeRankingIllusts: boolean };
type FollowParams = { restrict: Restrict };

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
    { id: "for-you", label: "为你推荐" },
    { id: "week", label: "本周热门" },
    { id: "follow", label: "关注作者新作" },
];

const INITIAL: Record<TabId, TabState> = {
    "for-you": { status: "idle" },
    week: { status: "idle" },
    follow: { status: "idle" },
};

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

function fetchTab(
    id: TabId,
    forYou: ForYouParams,
    follow: FollowParams,
    offset?: number,
): Promise<{ data: IllustPage | null; error: IllustApiError | null }> {
    if (id === "for-you")
        return listRecommended({
            type: forYou.type,
            includeRankingIllusts: forYou.includeRankingIllusts,
            offset,
        });
    if (id === "week") return listRanking({ mode: "week", offset });
    return listFollowingIllusts({ restrict: follow.restrict, offset });
}

function toFreshSuccess(data: IllustPage): TabState {
    return {
        status: "success",
        illusts: data.illusts,
        nextOffset: data.next_offset ?? null,
        loadingMore: false,
        refreshing: false,
    };
}

function HomeIllustTabs() {
    const { selected, toggle, replaceSelection, clearSelection } = useIllustSelection();
    const [activeTab, setActiveTab] = useState<TabId>("for-you");
    const [forYou, setForYou] = useState<ForYouParams>(DEFAULT_FOR_YOU);
    const [follow, setFollow] = useState<FollowParams>(DEFAULT_FOLLOW);
    const [states, setStates] = useState<Record<TabId, TabState>>(INITIAL);
    const versionRef = useRef<Record<TabId, number>>({ "for-you": 0, week: 0, follow: 0 });
    const state = states[activeTab];

    const rawIllusts = state.status === "success" ? state.illusts : undefined;
    const { filtered, totalBefore, totalAfter } = useFilteredIllusts(rawIllusts);
    const currentIllustIds = useMemo(() => filtered.map((il) => il.id), [filtered]);
    useQuickActionPanel({
        selected,
        allIllustIds: currentIllustIds,
        onReplaceSelection: replaceSelection,
        onClearSelection: clearSelection,
    });

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
    });

    const replaceAll = useCallback((id: TabId, forYouParams: ForYouParams, followParams: FollowParams) => {
        const version = ++versionRef.current[id];
        setStates((prev) => {
            const c = prev[id];
            if (c.status === "success") return { ...prev, [id]: { ...c, refreshing: true } };
            return { ...prev, [id]: { status: "loading" } };
        });
        fetchTab(id, forYouParams, followParams).then(({ data, error }) => {
            if (versionRef.current[id] !== version) return;
            setStates((prev) => ({
                ...prev,
                [id]: error ? { status: "error", error } : data ? toFreshSuccess(data) : { status: "idle" },
            }));
        });
    }, []);

    // Initial fetch: only when entering an idle tab.
    useEffect(() => {
        if (states[activeTab].status === "idle") replaceAll(activeTab, forYou, follow);
    }, [activeTab, states, replaceAll, forYou, follow]);

    // Refetch a tab when its server-side params change. Skip the very first render
    // — initial fetch is handled by the idle-tab effect above.
    const firstForYou = useRef(true);
    const firstFollow = useRef(true);
    // biome-ignore lint/correctness/useExhaustiveDependencies: replaceAll/follow are read at call time
    useEffect(() => {
        if (firstForYou.current) {
            firstForYou.current = false;
            return;
        }
        replaceAll("for-you", forYou, follow);
    }, [forYou.type, forYou.includeRankingIllusts]);
    // biome-ignore lint/correctness/useExhaustiveDependencies: replaceAll/forYou are read at call time
    useEffect(() => {
        if (firstFollow.current) {
            firstFollow.current = false;
            return;
        }
        replaceAll("follow", forYou, follow);
    }, [follow.restrict]);

    const handleTabChange = (v: string) => {
        if (v === activeTab) return;
        clearSelection();
        setActiveTab(v as TabId);
    };

    const handleRefresh = () => {
        const cur = states[activeTab];
        if (cur.status === "loading") return;
        if (cur.status === "success" && (cur.loadingMore || cur.refreshing)) return;
        replaceAll(activeTab, forYou, follow);
    };

    const handleLoadMore = () => {
        if (state.status !== "success" || state.nextOffset == null) return;
        if (state.loadingMore || state.refreshing) return;
        const id = activeTab;
        const offset = state.nextOffset;
        const version = versionRef.current[id];

        setStates((prev) => {
            const c = prev[id];
            if (c.status !== "success") return prev;
            return { ...prev, [id]: { ...c, loadingMore: true } };
        });
        fetchTab(id, forYou, follow, offset).then(({ data, error }) => {
            if (versionRef.current[id] !== version) return;
            setStates((prev) => {
                const c = prev[id];
                if (c.status !== "success") return prev;
                if (error || !data) return { ...prev, [id]: { ...c, loadingMore: false } };
                return {
                    ...prev,
                    [id]: {
                        ...c,
                        illusts: [...c.illusts, ...data.illusts],
                        nextOffset: data.next_offset ?? null,
                        loadingMore: false,
                    },
                };
            });
        });
    };

    const refreshDisabled =
        state.status === "loading" || (state.status === "success" && (state.loadingMore || state.refreshing));
    const refreshSpinning = state.status === "loading" || (state.status === "success" && state.refreshing);

    return (
        <section>
            <div className="mb-4 flex items-center border-muted/60 border-b">
                <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1">
                    <TabsList variant="line" className="h-12 gap-0">
                        {TABS.map((t) => (
                            <TabsTrigger
                                key={t.id}
                                value={t.id}
                                className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                            >
                                {t.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                <div className="pb-1.5">
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleRefresh}
                        disabled={refreshDisabled}
                        aria-label="刷新"
                    >
                        <HugeiconsIcon
                            icon={RefreshIcon}
                            strokeWidth={2.5}
                            className={cn(refreshSpinning && "animate-spin")}
                        />
                    </Button>
                </div>
            </div>

            {(state.status === "idle" || state.status === "loading") && <IllustGridSkeleton />}
            {state.status === "error" && <SearchError error={state.error} />}
            {state.status === "success" &&
                (state.illusts.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-20 text-center">
                        <div className="font-medium text-foreground text-lg">暂无数据</div>
                    </div>
                ) : filtered.length === 0 ? (
                    <FilteredEmpty totalBefore={totalBefore} />
                ) : (
                    <>
                        <IllustGrid illusts={filtered} selected={selected} onToggle={toggle} />
                        {state.nextOffset != null && (
                            <div className="flex justify-end pt-6 pb-2">
                                <button
                                    type="button"
                                    className="font-semibold text-4xl text-muted-foreground hover:underline"
                                    onClick={handleLoadMore}
                                    disabled={state.loadingMore || state.refreshing}
                                >
                                    {state.loadingMore ? <LeapyLoading className="px-3" size={16} /> : "查看更多"}
                                </button>
                            </div>
                        )}
                    </>
                ))}
        </section>
    );
}

export default HomeIllustTabs;
