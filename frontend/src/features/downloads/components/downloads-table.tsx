import { HugeiconsIcon } from "@hugeicons/react";
import { memo, type ReactNode, useState } from "react";
import PximgImage from "@/components/pximg-image";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DownloadApiError, DownloadJob, DownloadStatus, DownloadTask } from "@/features/downloads";
import { isTerminalStatus, useDownloadMutations } from "@/features/downloads";
import ActionIconButton from "@/features/downloads/components/action-icon-button";
import { useMessages } from "@/i18n";
import { formatBytes, hueFromId } from "@/lib/format";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, DeleteIcon, RedoDotIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<DownloadStatus, string> = {
    queued: "bg-muted text-muted-foreground",
    running: "bg-primary/15 text-primary",
    completed: "bg-chart-3/15 text-chart-3",
    failed: "bg-destructive/15 text-destructive",
    cancelled: "bg-destructive/15 text-destructive",
};

// Per-page byte sizes aren't known until each page's download starts (Pixiv's
// metadata omits them), so a byte-ratio progress would only reflect the started
// subset and snap backward as new sizes land. Weight each page equally instead —
// the task count is known up front — with partial credit for the page in flight.
// Single-image works and ugoira have one task, so this reduces to byte progress.
function jobProgress(job: DownloadJob) {
    const tasks = job.tasks;
    let downloaded = 0;
    let total = 0;
    let fraction = 0;
    for (const t of tasks) {
        downloaded += t.downloaded_bytes;
        if (t.size_bytes > 0) total += t.size_bytes;
        if (isTerminalStatus(t.status)) {
            fraction += 1;
        } else if (t.status === "running" && t.size_bytes > 0) {
            fraction += Math.min(1, t.downloaded_bytes / t.size_bytes);
        }
    }
    if (tasks.length === 0) {
        return { downloaded, total, pct: job.status === "completed" ? 100 : 0 };
    }
    const pct = Math.min(100, (fraction / tasks.length) * 100);
    return { downloaded, total, pct };
}

function StatusBadge({ status, className }: { status: DownloadStatus; className?: string }) {
    const m = useMessages();
    const label =
        status === "queued"
            ? m.status_queued()
            : status === "running"
              ? m.status_running()
              : status === "completed"
                ? m.status_completed()
                : status === "failed"
                  ? m.status_failed()
                  : m.status_cancelled();
    return <span className={cn("rounded-full p-2 py-1 text-[10px]", STATUS_TONE[status], className)}>{label}</span>;
}

function TaskRow({ task, compact }: { task: DownloadTask; compact: boolean }) {
    const pct = task.size_bytes > 0 ? Math.min(100, (task.downloaded_bytes / task.size_bytes) * 100) : null;
    return (
        <tr className="border-muted/40 border-t bg-muted/20">
            <td className="px-[18px] py-2 pl-23.5 align-middle">
                <div className="flex items-center gap-2">
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
                {task.status === "running" ? (
                    <div className="flex items-center gap-2.5">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${pct ?? 0}%` }} />
                        </div>
                        <span className="min-w-8 text-right font-mono text-[11px] text-muted-foreground">
                            {pct != null ? `${pct.toFixed(pct >= 99.95 ? 0 : 1)}%` : "—"}
                        </span>
                    </div>
                ) : (
                    <StatusBadge status={task.status} />
                )}
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
    isFirst: boolean;
    error?: DownloadApiError;
    submitError?: DownloadApiError;
    cancel: (jobId: string) => Promise<void>;
    submit: (illustId: number) => Promise<DownloadJob | null>;
    remove: (jobId: string) => Promise<void>;
};

function JobRowInner({ job, compact, isFirst, error, submitError, cancel, submit, remove }: JobRowProps) {
    const m = useMessages();
    const [expanded, setExpanded] = useState(false);
    const { downloaded, total, pct } = jobProgress(job);
    const hue = hueFromId(job.illust_id);
    const terminal = isTerminalStatus(job.status);
    const typeLabel =
        job.illust_type === "manga"
            ? m.downloads_type_manga()
            : job.illust_type === "ugoira"
              ? m.downloads_type_ugoira()
              : m.downloads_type_illust();

    return (
        <>
            <tr
                className={cn(
                    "transition-colors hover:bg-muted/30",
                    !isFirst && "border-muted/40 border-t",
                    error && "ring-1 ring-destructive/40 ring-inset",
                )}
            >
                <td className="px-[18px] py-3 align-middle">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            aria-label={expanded ? m.downloads_collapse_tasks() : m.downloads_expand_tasks()}
                            aria-expanded={expanded}
                            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/60"
                        >
                            <HugeiconsIcon
                                icon={expanded ? ChevronDownIcon : ChevronRightIcon}
                                size={12}
                                strokeWidth={1.5}
                            />
                        </button>
                        <PximgImage
                            src={job.preview_url}
                            alt={job.title || `#${job.illust_id}`}
                            fallback={
                                <div
                                    className="size-8 shrink-0 rounded-lg"
                                    style={{ background: `oklch(0.86 0.06 ${hue})` }}
                                />
                            }
                            className="size-8 shrink-0 rounded-lg object-cover"
                        />
                        <div className="min-w-0">
                            <div className="truncate font-medium text-foreground text-sm">
                                {job.title || m.downloads_untitled()}
                            </div>
                            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span>#{job.illust_id}</span>
                                <span>·</span>
                                <span>{typeLabel}</span>
                                <span>·</span>
                                <span>{m.downloads_task_count({ count: job.tasks.length })}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td className="px-[18px] py-3 align-middle">
                    {job.status === "running" ? (
                        <div className="flex items-center gap-2.5">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="min-w-8 text-right font-mono text-[11px] text-muted-foreground">
                                {Math.round(pct)}%
                            </span>
                        </div>
                    ) : (
                        <StatusBadge status={job.status} />
                    )}
                </td>
                {!compact && (
                    <>
                        <td className="px-[18px] py-3 text-right font-mono text-muted-foreground text-xs">
                            {terminal ? (total > 0 ? formatBytes(total) : "-") : formatBytes(downloaded)}
                        </td>
                        <td className="px-[18px] py-3 text-right">
                            <div className="inline-flex gap-1">
                                {!terminal && (
                                    <ActionIconButton
                                        icon={CloseIcon}
                                        title={m.downloads_action_cancel()}
                                        onAction={() => cancel(job.id)}
                                        confirm={{
                                            body: m.downloads_action_cancel_confirm(),
                                            confirmLabel: m.common_confirm(),
                                            danger: true,
                                        }}
                                        error={error}
                                    />
                                )}
                                {job.status === "completed" && (
                                    <ActionIconButton
                                        icon={RedoDotIcon}
                                        title={m.downloads_action_redownload()}
                                        onAction={async () => {
                                            await submit(job.illust_id);
                                        }}
                                        confirm={{
                                            body: m.downloads_action_redownload_confirm(),
                                            confirmLabel: m.downloads_action_redownload(),
                                        }}
                                        error={submitError}
                                    />
                                )}
                                {(job.status === "failed" || job.status === "cancelled") && (
                                    <ActionIconButton
                                        icon={RedoDotIcon}
                                        title={m.downloads_action_retry()}
                                        onAction={async () => {
                                            await submit(job.illust_id);
                                        }}
                                        error={submitError}
                                    />
                                )}
                                {terminal && (
                                    <ActionIconButton
                                        icon={DeleteIcon}
                                        title={m.downloads_action_remove()}
                                        onAction={() => remove(job.id)}
                                        confirm={{
                                            body: m.downloads_action_remove_confirm(),
                                            confirmLabel: m.downloads_action_remove(),
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
    // Hides the "Size" and "Actions" columns; used on the home page where width is tight.
    compact?: boolean;
};

function DownloadsTable({ jobs, empty, compact = false }: DownloadsTableProps) {
    const m = useMessages();
    const { cancel, remove, submit, lastError } = useDownloadMutations();

    if (jobs.length === 0) {
        return (
            empty ?? (
                <div className="px-[18px] py-8 text-center text-muted-foreground text-sm">
                    {m.downloads_empty_all()}
                </div>
            )
        );
    }
    return (
        <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
                <col />
                <col className={compact ? "w-[25%]" : "w-[15%]"} />
                {!compact && (
                    <>
                        <col className="w-44" />
                        <col className="w-44" />
                    </>
                )}
            </colgroup>
            {!compact && (
                <thead>
                    <tr className="bg-muted/40 text-[11px] text-muted-foreground">
                        <th className="px-[18px] py-2.5 text-left font-medium">{m.downloads_col_work()}</th>
                        <th className="px-[18px] py-2.5 text-left font-medium">{m.downloads_col_progress()}</th>
                        <th className="px-[18px] py-2.5 text-right font-medium">{m.downloads_col_size()}</th>
                        <th className="px-[18px] py-2.5 text-right font-medium">{m.downloads_col_action()}</th>
                    </tr>
                </thead>
            )}
            <tbody>
                {jobs.map((job, i) => (
                    <JobRow
                        key={job.id}
                        job={job}
                        compact={compact}
                        isFirst={i === 0}
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
