import { useContext } from "react";
import { DownloadsContext } from "./downloads-context";

export function useDownloads() {
    const ctx = useContext(DownloadsContext);
    if (!ctx) throw new Error("useDownloads must be used inside <DownloadsProvider>");
    return ctx;
}
