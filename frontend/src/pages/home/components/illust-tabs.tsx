import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import LeapyLoading from "@/components/series-leapy/leapy-loading";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIllustSelection } from "@/features/downloads";
import DownloadFAB from "@/features/downloads/components/download-fab";
import {
    type Illust,
    type IllustApiError,
    type IllustPage,
    listFollowingIllusts,
    listRecommended,
} from "@/features/illusts/api";
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

function fetchTab(id: TabId, offset?: number): Promise<{ data: IllustPage | null; error: IllustApiError | null }> {
    if (id === "for-you") return listRecommended({ offset });
    if (id === "week") return listRanking({ mode: "week", offset });
    return listFollowingIllusts({ offset });
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
    const [states, setStates] = useState<Record<TabId, TabState>>(INITIAL);
    const versionRef = useRef<Record<TabId, number>>({ "for-you": 0, week: 0, follow: 0 });
    const state = states[activeTab];
    const currentIllustIds = state.status === "success" ? state.illusts.map((il) => il.id) : [];

    const replaceAll = useCallback((id: TabId) => {
        const version = ++versionRef.current[id];
        setStates((prev) => {
            const c = prev[id];
            if (c.status === "success") return { ...prev, [id]: { ...c, refreshing: true } };
            return { ...prev, [id]: { status: "loading" } };
        });
        fetchTab(id).then(({ data, error }) => {
            if (versionRef.current[id] !== version) return;
            setStates((prev) => ({
                ...prev,
                [id]: error ? { status: "error", error } : data ? toFreshSuccess(data) : { status: "idle" },
            }));
        });
    }, []);

    useEffect(() => {
        if (states[activeTab].status === "idle") replaceAll(activeTab);
    }, [activeTab, states, replaceAll]);

    const handleTabChange = (v: string) => {
        if (v === activeTab) return;
        clearSelection();
        setActiveTab(v as TabId);
    };

    const handleRefresh = () => {
        const cur = states[activeTab];
        if (cur.status === "loading") return;
        if (cur.status === "success" && (cur.loadingMore || cur.refreshing)) return;
        replaceAll(activeTab);
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
        fetchTab(id, offset).then(({ data, error }) => {
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
                ) : (
                    <>
                        <IllustGrid illusts={state.illusts} selected={selected} onToggle={toggle} />
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
            <DownloadFAB
                selected={selected}
                allIllustIds={currentIllustIds}
                onReplaceSelection={replaceSelection}
                onClearSelection={clearSelection}
            />
        </section>
    );
}

export default HomeIllustTabs;
