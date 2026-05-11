// Wire shapes for download.* SSE events. Mirrors internal/download/publisher.go.

export type JobEventData = {
    job_id: string;
    illust_id: number;
    task_count: number;
    error?: string;
};

export type TaskStartedData = {
    job_id: string;
    task_id: string;
    url: string;
    file_path: string;
};

export type TaskProgressData = {
    job_id: string;
    task_id: string;
    downloaded: number;
    total: number;
};

export type TaskCompletedData = TaskStartedData;

export type TaskFailedData = TaskStartedData & { error: string };

export type TaskCancelledData = TaskStartedData;
