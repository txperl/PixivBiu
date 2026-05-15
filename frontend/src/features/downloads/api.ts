import { api, type components } from "@/lib/api";

export type DownloadJob = components["schemas"]["DownloadJob"];
export type DownloadTask = components["schemas"]["DownloadTask"];
export type DownloadStatus = components["schemas"]["DownloadStatus"];
export type DownloadIllustType = components["schemas"]["DownloadIllustType"];
export type DownloadJobList = components["schemas"]["DownloadJobList"];
export type DownloadApiError = components["schemas"]["Error"];

export const ACTIVE_STATUSES: ReadonlyArray<DownloadStatus> = ["queued", "running"];

export function isTerminalStatus(s: DownloadStatus): boolean {
    return s === "completed" || s === "failed" || s === "cancelled";
}

export type ListDownloadsQuery = {
    status?: DownloadStatus | DownloadStatus[];
    page?: number;
    perPage?: number;
    updatedSince?: Date;
};

function serializeStatus(s: ListDownloadsQuery["status"]): string | undefined {
    if (!s) return undefined;
    return Array.isArray(s) ? s.join(",") : s;
}

export async function listDownloads(
    query: ListDownloadsQuery = {},
): Promise<{ data: DownloadJobList | null; error: DownloadApiError | null }> {
    const { data, error } = await api.GET("/downloads", {
        params: {
            query: {
                status: serializeStatus(query.status),
                page: query.page,
                per_page: query.perPage,
                updated_since: query.updatedSince?.toISOString(),
            },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

export async function getDownload(
    jobId: string,
): Promise<{ data: DownloadJob | null; error: DownloadApiError | null }> {
    const { data, error } = await api.GET("/downloads/{id}", {
        params: { path: { id: jobId } },
    });
    return { data: data ?? null, error: error ?? null };
}

export async function submitDownload(
    illustId: number,
): Promise<{ data: DownloadJob | null; error: DownloadApiError | null }> {
    const { data, error } = await api.POST("/downloads", {
        body: { illust_id: illustId },
    });
    return { data: data ?? null, error: error ?? null };
}

export async function cancelDownload(jobId: string): Promise<{ error: DownloadApiError | null }> {
    const { error } = await api.POST("/downloads/{id}/cancel", {
        params: { path: { id: jobId } },
    });
    return { error: error ?? null };
}

export async function removeDownload(jobId: string): Promise<{ error: DownloadApiError | null }> {
    const { error } = await api.DELETE("/downloads/{id}", {
        params: { path: { id: jobId } },
    });
    return { error: error ?? null };
}
