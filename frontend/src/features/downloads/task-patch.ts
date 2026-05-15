import type { DownloadJob, DownloadTask } from "./api";

// Returns the same job if no task matched or the patcher signalled a
// no-op by returning its argument; otherwise a clone with the patched
// task. Callers use === equality on the result to skip downstream work.
export function patchJobTask(
    job: DownloadJob,
    taskId: string,
    patcher: (task: DownloadTask) => DownloadTask,
): DownloadJob {
    let changed = false;
    const tasks = job.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const next = patcher(t);
        if (next !== t) changed = true;
        return next;
    });
    return changed ? { ...job, tasks } : job;
}
