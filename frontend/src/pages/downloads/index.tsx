import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Sheet } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import type { DownloadStatus } from "@/features/downloads";
import {
    DOWNLOADS_PAGE_SIZE,
    TERMINAL_STATUSES,
    useDownloadCounts,
    useDownloadMutations,
    useDownloadsPage,
} from "@/features/downloads";
import ConfirmPopover from "@/features/downloads/components/confirm-popover";
import DownloadsPager from "@/features/downloads/components/downloads-pager";
import DownloadsTable from "@/features/downloads/components/downloads-table";
import { DeleteIcon, RefreshIcon } from "@/lib/icons";
import { patchParams, readPage } from "@/lib/url-params";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "done" | "failed";

const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "active", label: "进行中" },
    { key: "done", label: "已完成" },
    { key: "failed", label: "失败/取消" },
];

const VALID_FILTERS = new Set<Filter>(FILTERS.map((f) => f.key));

// Maps the UI's filter buckets to the backend's status enum. "all" is
// undefined: no status query → server returns every job.
const FILTER_STATUSES: Record<Filter, DownloadStatus[] | undefined> = {
    all: undefined,
    active: ["queued", "running"],
    done: ["completed"],
    failed: ["failed", "cancelled"],
};

const EMPTY_MESSAGE: Record<Filter, string> = {
    all: "暂无下载",
    active: "当前没有进行中的下载",
    done: "还没有完成的下载",
    failed: "没有失败或取消的下载",
};

const CLEAR_STATUSES: Record<Exclude<Filter, "active">, DownloadStatus[]> = {
    all: [...TERMINAL_STATUSES],
    done: ["completed"],
    failed: ["failed", "cancelled"],
};

const CLEAR_LABEL: Record<Exclude<Filter, "active">, string> = {
    all: "已结束的",
    done: "已完成的",
    failed: "失败/取消的",
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
    const [searchParams, setSearchParams] = useSearchParams();
    const [refreshing, setRefreshing] = useState(false);

    const filterParam = searchParams.get("filter") as Filter | null;
    const filter: Filter = filterParam && VALID_FILTERS.has(filterParam) ? filterParam : "all";
    const requestedPage = readPage(searchParams);

    const { items, total, isLoading, refetch } = useDownloadsPage({
        status: FILTER_STATUSES[filter],
        page: requestedPage,
    });
    const { activeCount } = useDownloadCounts();
    const { clear } = useDownloadMutations();
    const [clearing, setClearing] = useState(false);

    // "all" tab 的 total 含 active；终态数 = total - activeCount。
    // 其余非 active tab 的 total 本身即终态数。
    const clearableCount = filter === "active" ? 0 : filter === "all" ? Math.max(0, total - activeCount) : total;

    const totalPages = Math.max(1, Math.ceil(total / DOWNLOADS_PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, requestedPage), totalPages);

    // Reflect server-side clamping back into the URL: if requestedPage is
    // out of range (e.g. items were removed), navigate to a valid page.
    useEffect(() => {
        if (isLoading) return;
        if (requestedPage === currentPage) return;
        setSearchParams(
            (sp) =>
                patchParams(sp, {
                    page: currentPage === 1 ? undefined : String(currentPage),
                }),
            { replace: true },
        );
    }, [isLoading, requestedPage, currentPage, setSearchParams]);

    const handleFilterChange = (next: Filter) => {
        // resetPage=true: switching filters always lands on page 1.
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
        await refetch();
        setRefreshing(false);
    };

    const onClear = async () => {
        if (filter === "active" || clearing) return;
        setClearing(true);
        try {
            await clear(CLEAR_STATUSES[filter]);
            await refetch();
        } finally {
            setClearing(false);
        }
    };

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-7 pb-7">
            <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h1 className="font-semibold text-5xl text-foreground">下载管理</h1>
                <span className="font-mono text-muted-foreground text-xs">
                    {activeCount} 进行 / {total} 全部
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
                {filter !== "active" && clearableCount > 0 && (
                    <ConfirmPopover
                        trigger={
                            <Button variant="ghost" size="icon-sm" disabled={clearing}>
                                <HugeiconsIcon icon={DeleteIcon} />
                            </Button>
                        }
                        body={`将清空 ${clearableCount} 条${CLEAR_LABEL[filter]}下载记录，已下载的文件会被保留。`}
                        confirmLabel="清空"
                        danger
                        onConfirm={onClear}
                    />
                )}
                <Button variant="ghost" size="icon-sm" onClick={onRefresh} disabled={refreshing}>
                    <HugeiconsIcon icon={RefreshIcon} className={cn(refreshing && "animate-spin")} />
                </Button>
            </div>

            <Sheet>
                {isLoading ? (
                    <div className="px-[18px] py-16 text-center text-muted-foreground text-sm">加载中…</div>
                ) : (
                    <DownloadsTable jobs={items} empty={<DownloadsEmpty filter={filter} />} />
                )}
            </Sheet>

            {!isLoading && totalPages > 1 && (
                <DownloadsPager currentPage={currentPage} totalPages={totalPages} onJump={handleJump} />
            )}
        </div>
    );
}

export default DownloadsPage;
