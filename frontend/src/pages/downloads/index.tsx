import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Sheet } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import type { DownloadJob } from "@/features/downloads";
import { useDownloads } from "@/features/downloads";
import DownloadsPager from "@/features/downloads/components/downloads-pager";
import DownloadsTable from "@/features/downloads/components/downloads-table";
import { RefreshIcon } from "@/lib/icons";
import { patchParams, readPage } from "@/lib/url-params";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "done" | "failed";

const PAGE_SIZE = 20;

const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "active", label: "进行中" },
    { key: "done", label: "已完成" },
    { key: "failed", label: "失败/取消" },
];

const VALID_FILTERS = new Set<Filter>(FILTERS.map((f) => f.key));

const FILTER_PREDICATES: Record<Filter, (job: DownloadJob) => boolean> = {
    all: () => true,
    active: (j) => j.status === "queued" || j.status === "running",
    done: (j) => j.status === "completed",
    failed: (j) => j.status === "failed" || j.status === "cancelled",
};

const EMPTY_MESSAGE: Record<Filter, string> = {
    all: "暂无下载",
    active: "当前没有进行中的下载",
    done: "还没有完成的下载",
    failed: "没有失败或取消的下载",
};

function DownloadsEmpty({ filter }: { filter: Filter }) {
    return (
        <div className="px-[18px] py-16 text-center">
            <div className="font-medium text-foreground text-sm">{EMPTY_MESSAGE[filter]}</div>
            <div className="mt-1 text-muted-foreground text-xs">从作品卡片右下角的下载按钮开始</div>
        </div>
    );
}

function DownloadsPage() {
    const { jobs, activeCount, doneCount, refresh, initialLoaded } = useDownloads();
    const [searchParams, setSearchParams] = useSearchParams();
    const [refreshing, setRefreshing] = useState(false);

    const filterParam = searchParams.get("filter") as Filter | null;
    const filter: Filter = filterParam && VALID_FILTERS.has(filterParam) ? filterParam : "all";
    const requestedPage = readPage(searchParams);

    const filtered = useMemo(() => jobs.filter(FILTER_PREDICATES[filter]), [jobs, filter]);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
    const pageJobs = useMemo(
        () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
        [filtered, currentPage],
    );

    useEffect(() => {
        if (!initialLoaded) return;
        if (requestedPage === currentPage) return;
        setSearchParams(
            (sp) =>
                patchParams(sp, {
                    page: currentPage === 1 ? undefined : String(currentPage),
                }),
            { replace: true },
        );
    }, [initialLoaded, requestedPage, currentPage, setSearchParams]);

    const handleFilterChange = (next: Filter) => {
        setSearchParams(patchParams(searchParams, { filter: next === "all" ? undefined : next }, true));
    };

    const handleJump = (page: number) => {
        setSearchParams(
            patchParams(searchParams, {
                page: page === 1 ? undefined : String(page),
            }),
        );
    };

    const onRefresh = async () => {
        if (refreshing) return;
        setRefreshing(true);
        await refresh();
        setRefreshing(false);
    };

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-7 pb-7">
            <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h1 className="font-semibold text-5xl text-foreground">下载管理</h1>
                <span className="font-mono text-muted-foreground text-sm">
                    {activeCount} 进行 / {doneCount} 完成
                </span>
            </header>

            <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map((f) => (
                    <button
                        key={f.key}
                        type="button"
                        onClick={() => handleFilterChange(f.key)}
                        className={cn(
                            "inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-xs transition-colors",
                            filter === f.key
                                ? "bg-secondary font-medium text-secondary-foreground"
                                : "bg-card text-muted-foreground hover:bg-muted",
                        )}
                    >
                        {f.label}
                    </button>
                ))}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
                    <HugeiconsIcon icon={RefreshIcon} className={cn(refreshing && "animate-spin")} />
                    刷新
                </Button>
            </div>

            <Sheet>
                {!initialLoaded ? (
                    <div className="px-[18px] py-16 text-center text-muted-foreground text-sm">加载中…</div>
                ) : (
                    <DownloadsTable jobs={pageJobs} empty={<DownloadsEmpty filter={filter} />} />
                )}
            </Sheet>

            {initialLoaded && totalPages > 1 && (
                <DownloadsPager currentPage={currentPage} totalPages={totalPages} onJump={handleJump} />
            )}
        </div>
    );
}

export default DownloadsPage;
