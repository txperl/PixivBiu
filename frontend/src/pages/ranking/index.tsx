import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import {
    DEFAULT_RANKING_MODE,
    type IllustPage,
    isRankingMode,
    listRanking,
    modeFor,
    periodOf,
    RANKING_PAGE_SIZE,
    type RankingApiError,
    type RankingMode,
    type RankingPeriod,
    type RankingVariantKey,
    variantKeyOf,
} from "@/features/ranking/api";
import RankingDatePicker from "@/features/ranking/components/ranking-date-picker";
import RankingFilters from "@/features/ranking/components/ranking-filters";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
import SearchPager from "@/features/search/components/search-pager";
import { SearchError } from "@/features/search/components/search-states";

type FetchState<T> =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; data: T }
    | { status: "error"; error: RankingApiError };

function readMode(sp: URLSearchParams): RankingMode {
    const v = sp.get("mode");
    return isRankingMode(v) ? v : DEFAULT_RANKING_MODE;
}

function readDate(sp: URLSearchParams): string | undefined {
    const v = sp.get("date");
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

function readPage(sp: URLSearchParams): number {
    const n = Number(sp.get("page"));
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function RankingEmpty({ date }: { date?: string }) {
    return (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="font-medium text-foreground text-lg">
                {date ? `「${date}」暂无排行榜数据` : "暂无排行榜数据"}
            </div>
            <div className="text-muted-foreground text-sm">换个日期或类型试试</div>
        </div>
    );
}

function RankingPage() {
    const [searchParams, setSearchParams] = useSearchParams();

    const mode = readMode(searchParams);
    const date = readDate(searchParams);
    const page = readPage(searchParams);
    const period = periodOf(mode);
    const variantKey = variantKeyOf(mode);

    const [state, setState] = useState<FetchState<IllustPage>>({ status: "idle" });

    useEffect(() => {
        let cancelled = false;
        setState({ status: "loading" });
        const offset = (page - 1) * RANKING_PAGE_SIZE;
        listRanking({ mode, date, offset }).then(({ data, error }) => {
            if (cancelled) return;
            if (error) setState({ status: "error", error });
            else if (data) setState({ status: "success", data });
        });
        return () => {
            cancelled = true;
        };
    }, [mode, date, page]);

    const updateParams = (patch: Record<string, string | undefined>, resetPage = false) => {
        const next = new URLSearchParams(searchParams);
        for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) next.delete(k);
            else next.set(k, v);
        }
        if (resetPage) next.delete("page");
        setSearchParams(next);
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
        document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
    };

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-7 pb-7">
            <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h1 className="font-semibold text-5xl text-foreground">排行榜</h1>
                <RankingDatePicker date={date} onDateChange={onDateChange} />
            </header>

            <RankingFilters
                period={period}
                variantKey={variantKey}
                onPeriodChange={onPeriodChange}
                onVariantChange={onVariantChange}
            />

            {state.status === "loading" && <IllustGridSkeleton />}
            {state.status === "error" && <SearchError error={state.error} />}
            {state.status === "success" &&
                (state.data.illusts.length === 0 ? (
                    <RankingEmpty date={date} />
                ) : (
                    <IllustGrid illusts={state.data.illusts} />
                ))}

            {state.status === "success" && state.data.illusts.length > 0 && (
                <SearchPager currentPage={page} hasNext={state.data.next_offset != null} onJump={onJumpPage} />
            )}
        </div>
    );
}

export default RankingPage;
