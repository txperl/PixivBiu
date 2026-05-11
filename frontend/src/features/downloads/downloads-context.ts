import { createContext } from "react";
import type { DownloadApiError, DownloadJob } from "./api";

export interface DownloadsContextValue {
    jobs: DownloadJob[];
    activeCount: number;
    doneCount: number;
    lastError: Record<string, DownloadApiError>;
    initialLoaded: boolean;
    submit: (illustId: number) => Promise<DownloadJob | null>;
    cancel: (jobId: string) => Promise<void>;
    remove: (jobId: string, purgeFiles: boolean) => Promise<void>;
    refresh: () => Promise<void>;
}

export const DownloadsContext = createContext<DownloadsContextValue | null>(null);
