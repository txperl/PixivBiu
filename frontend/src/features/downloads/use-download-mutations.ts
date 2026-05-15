import { useContext } from "react";
import { DownloadStateContext } from "./download-state-context";

// submit / cancel / remove and the per-key error stash. lastError keys
// are `submit:${illustId}` for submits and the job_id for cancel/remove.
export function useDownloadMutations() {
    const ctx = useContext(DownloadStateContext);
    if (!ctx) throw new Error("useDownloadMutations must be used inside <DownloadStateProvider>");
    return {
        submit: ctx.submit,
        cancel: ctx.cancel,
        remove: ctx.remove,
        lastError: ctx.lastError,
    };
}
