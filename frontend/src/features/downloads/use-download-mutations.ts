import { useContext } from "react";
import { DownloadActionsContext, DownloadErrorsContext } from "./download-state-context";

// Stable submit / cancel / remove / clear plus the tracked-job store. Never
// changes after mount, so action-only consumers skip SSE-driven renders.
export function useDownloadActions() {
    const ctx = useContext(DownloadActionsContext);
    if (!ctx) throw new Error("useDownloadActions must be used inside <DownloadStateProvider>");
    return ctx;
}

// Actions plus the per-key error stash. lastError keys are
// `submit:${illustId}` for submits and the job_id for cancel/remove.
export function useDownloadMutations() {
    const { submit, cancel, remove, clear } = useDownloadActions();
    const lastError = useContext(DownloadErrorsContext);
    if (!lastError) throw new Error("useDownloadMutations must be used inside <DownloadStateProvider>");
    return { submit, cancel, remove, clear, lastError };
}
