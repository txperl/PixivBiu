import { api, type components } from "@/lib/api";

export type DownloadJob = components["schemas"]["DownloadJob"];
export type DownloadTask = components["schemas"]["DownloadTask"];
export type DownloadStatus = components["schemas"]["DownloadStatus"];
export type DownloadIllustType = components["schemas"]["DownloadIllustType"];
export type DownloadJobList = components["schemas"]["DownloadJobList"];
export type DownloadApiError = components["schemas"]["Error"];

export async function listDownloads(): Promise<{ data: DownloadJobList | null; error: DownloadApiError | null }> {
    const { data, error } = await api.GET("/downloads");
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

export async function removeDownload(jobId: string, purgeFiles: boolean): Promise<{ error: DownloadApiError | null }> {
    const { error } = await api.DELETE("/downloads/{id}", {
        params: {
            path: { id: jobId },
            query: { purgeFiles },
        },
    });
    return { error: error ?? null };
}
