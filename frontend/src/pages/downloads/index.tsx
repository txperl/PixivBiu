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
import { useMessages } from "@/i18n";
import { DeleteIcon, RefreshIcon } from "@/lib/icons";
import { patchParams, readPage } from "@/lib/url-params";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "done" | "failed";

const FILTER_KEYS: Filter[] = ["all", "active", "done", "failed"];

const VALID_FILTERS = new Set<Filter>(FILTER_KEYS);

// Maps the UI's filter buckets to the backend's status enum. "all" is
// undefined: no status query → server returns every job.
const FILTER_STATUSES: Record<Filter, DownloadStatus[] | undefined> = {
    all: undefined,
    active: ["queued", "running"],
    done: ["completed"],
    failed: ["failed", "cancelled"],
};

const CLEAR_STATUSES: Record<Exclude<Filter, "active">, DownloadStatus[]> = {
    all: [...TERMINAL_STATUSES],
    done: ["completed"],
    failed: ["failed", "cancelled"],
};

function DownloadsEmpty({ filter }: { filter: Filter }) {
    const m = useMessages();
    const messages: Record<Filter, string> = {
        all: m.downloads_empty_all(),
        active: m.downloads_empty_active(),
        done: m.downloads_empty_done(),
        failed: m.downloads_empty_failed(),
    };
    return (
        <div className="px-[18px] py-16 text-center">
            <div className="font-medium text-foreground text-sm">{messages[filter]}</div>
            <div className="mt-1 text-muted-foreground text-xs">{m.downloads_empty_hint()}</div>
        </div>
    );
}

function DownloadsPage() {
    const m = useMessages();
    const [searchParams, setSearchParams] = useSearchParams();
    const [refreshing, setRefreshing] = useState(false);

    const filterLabels: Record<Filter, string> = {
        all: m.downloads_filter_all(),
        active: m.downloads_filter_active(),
        done: m.downloads_filter_done(),
        failed: m.downloads_filter_failed(),
    };
    const clearLabels: Record<Exclude<Filter, "active">, string> = {
        all: m.downloads_clear_label_all(),
        done: m.downloads_clear_label_done(),
        failed: m.downloads_clear_label_failed(),
    };

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
    // Defer the loading text so a fast fetch (localhost) never flashes it; the
    // delay window renders nothing rather than the empty-state, which would flash too.
    const showLoading = useDelayedFlag(isLoading);

    // The "all" tab's total includes active jobs; terminal count = total - activeCount.
    // For other (non-active) tabs the total itself is already the terminal count.
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
                <h1 className="font-semibold text-5xl text-foreground">{m.downloads_title()}</h1>
                <span className="font-mono text-muted-foreground text-xs">
                    {m.downloads_counts({ active: activeCount, total })}
                </span>
            </header>

            <div className="flex flex-wrap items-center gap-2">
                {FILTER_KEYS.map((key) => (
                    <button
                        key={key}
                        type="button"
                        onClick={() => handleFilterChange(key)}
                        className={cn(
                            "inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-xs transition-colors",
                            filter === key
                                ? "bg-secondary font-medium text-secondary-foreground"
                                : "bg-card text-muted-foreground hover:bg-muted",
                        )}
                    >
                        {filterLabels[key]}
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
                        body={m.downloads_clear_confirm({
                            count: clearableCount,
                            label: clearLabels[filter as Exclude<Filter, "active">],
                        })}
                        confirmLabel={m.common_clear()}
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
                    showLoading ? (
                        <div className="px-[18px] py-16 text-center text-muted-foreground text-sm">
                            {m.common_loading()}
                        </div>
                    ) : null
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
