import { HugeiconsIcon } from "@hugeicons/react";
import { memo, type ReactNode, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DownloadApiError, DownloadJob, DownloadStatus, DownloadTask } from "@/features/downloads";
import { isTerminalStatus, useDownloadMutations } from "@/features/downloads";
import ActionIconButton from "@/features/downloads/components/action-icon-button";
import { formatBytes, hueFromId } from "@/lib/format";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, DeleteIcon, RefreshIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<DownloadStatus, string> = {
    queued: "排队中",
    running: "下载中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
};

const STATUS_TONE: Record<DownloadStatus, string> = {
    queued: "bg-muted text-muted-foreground",
    running: "bg-primary/15 text-primary",
    completed: "bg-chart-3/15 text-chart-3",
    failed: "bg-destructive/15 text-destructive",
    cancelled: "bg-muted text-muted-foreground",
};

const TYPE_LABEL: Record<DownloadJob["illust_type"], string> = {
    illust: "插画",
    manga: "漫画",
    ugoira: "动图",
};

function aggregateBytes(tasks: DownloadTask[]) {
    let downloaded = 0;
    let total = 0;
    for (const t of tasks) {
        downloaded += t.downloaded_bytes;
        if (t.size_bytes > 0) total += t.size_bytes;
    }
    return { downloaded, total };
}

function progressBarTone(status: DownloadStatus): string {
    if (status === "completed") return "bg-chart-3";
    if (status === "failed" || status === "cancelled") return "bg-muted-foreground/40";
    return "bg-primary";
}

function TaskRow({ task, compact }: { task: DownloadTask; compact: boolean }) {
    const pct = task.size_bytes > 0 ? Math.min(100, (task.downloaded_bytes / task.size_bytes) * 100) : null;
    return (
        <tr className="border-muted/40 border-t bg-muted/20">
            <td className="px-[18px] py-2 pl-14 align-middle">
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            "inline-flex h-4 min-w-10 items-center justify-center rounded-full px-1.5 text-[10px]",
                            STATUS_TONE[task.status],
                        )}
                    >
                        {STATUS_LABEL[task.status]}
                    </span>
                    <div className="min-w-0 flex-1">
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <div className="truncate font-mono text-[11px] text-muted-foreground">
                                        {task.file_path.split("/").pop() ?? task.file_path}
                                    </div>
                                }
                            />
                            <TooltipContent>{task.file_path}</TooltipContent>
                        </Tooltip>
                        {task.error && <div className="truncate text-[11px] text-destructive">{task.error}</div>}
                    </div>
                </div>
            </td>
            <td className="px-[18px] py-2 align-middle">
                <div className="flex items-center gap-2.5">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                            className={cn("h-full rounded-full", progressBarTone(task.status))}
                            style={{ width: `${pct ?? (task.status === "completed" ? 100 : 0)}%` }}
                        />
                    </div>
                    <span className="min-w-8 text-right font-mono text-[11px] text-muted-foreground">
                        {pct != null ? `${pct.toFixed(pct >= 99.95 ? 0 : 1)}%` : "—"}
                    </span>
                </div>
            </td>
            {!compact && (
                <>
                    <td className="px-[18px] py-2 text-right font-mono text-[11px] text-muted-foreground">
                        {formatBytes(task.downloaded_bytes)}
                    </td>
                    <td />
                </>
            )}
        </tr>
    );
}

type JobRowProps = {
    job: DownloadJob;
    compact: boolean;
    error?: DownloadApiError;
    submitError?: DownloadApiError;
    cancel: (jobId: string) => Promise<void>;
    submit: (illustId: number) => Promise<DownloadJob | null>;
    remove: (jobId: string) => Promise<void>;
};

function JobRowInner({ job, compact, error, submitError, cancel, submit, remove }: JobRowProps) {
    const [expanded, setExpanded] = useState(false);
    const { downloaded, total } = aggregateBytes(job.tasks);
    const pct = total > 0 ? Math.min(100, (downloaded / total) * 100) : job.status === "completed" ? 100 : 0;
    const hue = hueFromId(job.illust_id);
    const terminal = isTerminalStatus(job.status);

    return (
        <>
            <tr
                className={cn(
                    "border-muted/40 border-t transition-colors hover:bg-muted/30",
                    error && "ring-1 ring-destructive/40 ring-inset",
                )}
            >
                <td className="px-[18px] py-3 align-middle">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            aria-label={expanded ? "收起任务" : "展开任务"}
                            aria-expanded={expanded}
                            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/60"
                        >
                            <HugeiconsIcon
                                icon={expanded ? ChevronDownIcon : ChevronRightIcon}
                                size={12}
                                strokeWidth={1.5}
                            />
                        </button>
                        <div className="size-8 shrink-0 rounded-lg" style={{ background: `oklch(0.86 0.06 ${hue})` }} />
                        <div className="min-w-0">
                            <div className="truncate font-medium text-foreground text-sm">{job.title || "未命名"}</div>
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span>#{job.illust_id}</span>
                                <span>·</span>
                                <span>{TYPE_LABEL[job.illust_type]}</span>
                                <span>·</span>
                                <span>{job.tasks.length} 任务</span>
                                <span
                                    className={cn(
                                        "ml-1 inline-flex h-4 items-center rounded-full px-1.5 text-[10px]",
                                        STATUS_TONE[job.status],
                                    )}
                                >
                                    {STATUS_LABEL[job.status]}
                                </span>
                            </div>
                        </div>
                    </div>
                </td>
                <td className="px-[18px] py-3 align-middle">
                    <div className="flex items-center gap-2.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                                className={cn("h-full rounded-full", progressBarTone(job.status))}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                        <span className="min-w-8 text-right font-mono text-[11px] text-muted-foreground">
                            {Math.round(pct)}%
                        </span>
                    </div>
                </td>
                {!compact && (
                    <>
                        <td className="px-[18px] py-3 text-right font-mono text-muted-foreground text-xs">
                            {formatBytes(downloaded)}
                            {total > 0 && ` / ${formatBytes(total)}`}
                        </td>
                        <td className="px-[18px] py-3 text-right">
                            <div className="inline-flex gap-1">
                                {!terminal && (
                                    <ActionIconButton
                                        icon={CloseIcon}
                                        title="取消下载"
                                        onAction={() => cancel(job.id)}
                                        confirm={{
                                            body: "取消将清除已下载的部分文件，确定吗？",
                                            confirmLabel: "确定取消",
                                            danger: true,
                                        }}
                                        error={error}
                                    />
                                )}
                                {job.status === "completed" && (
                                    <ActionIconButton
                                        icon={RefreshIcon}
                                        title="重新下载"
                                        onAction={async () => {
                                            await submit(job.illust_id);
                                        }}
                                        confirm={{
                                            body: "将创建新的下载副本，确定重新下载？",
                                            confirmLabel: "重新下载",
                                        }}
                                        error={submitError}
                                    />
                                )}
                                {(job.status === "failed" || job.status === "cancelled") && (
                                    <ActionIconButton
                                        icon={RefreshIcon}
                                        title="重试"
                                        onAction={async () => {
                                            await submit(job.illust_id);
                                        }}
                                        error={submitError}
                                    />
                                )}
                                {terminal && (
                                    <ActionIconButton
                                        icon={DeleteIcon}
                                        title="移除"
                                        onAction={() => remove(job.id)}
                                        confirm={{
                                            body: "将从下载历史中移除此记录（已下载文件保留在磁盘）。",
                                            confirmLabel: "移除",
                                        }}
                                        error={error}
                                    />
                                )}
                            </div>
                        </td>
                    </>
                )}
            </tr>
            {expanded && job.tasks.map((t) => <TaskRow key={t.id} task={t} compact={compact} />)}
        </>
    );
}

const JobRow = memo(JobRowInner);

type DownloadsTableProps = {
    jobs: DownloadJob[];
    empty?: ReactNode;
    // Hides "大小" and "操作" columns; used on the home page where width is tight.
    compact?: boolean;
};

function DownloadsTable({ jobs, empty, compact = false }: DownloadsTableProps) {
    const { cancel, remove, submit, lastError } = useDownloadMutations();

    if (jobs.length === 0) {
        return empty ?? <div className="px-[18px] py-8 text-center text-muted-foreground text-sm">暂无下载</div>;
    }
    return (
        <table className="w-full border-collapse text-sm">
            <thead>
                <tr className="bg-muted/40 text-[11px] text-muted-foreground">
                    <th className="px-[18px] py-2.5 text-left font-medium">作品</th>
                    <th className="px-[18px] py-2.5 text-left font-medium">进度</th>
                    {!compact && (
                        <>
                            <th className="px-[18px] py-2.5 text-right font-medium">大小</th>
                            <th className="w-20 px-[18px] py-2.5 text-right font-medium">操作</th>
                        </>
                    )}
                </tr>
            </thead>
            <tbody>
                {jobs.map((job) => (
                    <JobRow
                        key={job.id}
                        job={job}
                        compact={compact}
                        error={lastError[job.id]}
                        submitError={lastError[`submit:${job.illust_id}`]}
                        cancel={cancel}
                        submit={submit}
                        remove={remove}
                    />
                ))}
            </tbody>
        </table>
    );
}

export default DownloadsTable;
