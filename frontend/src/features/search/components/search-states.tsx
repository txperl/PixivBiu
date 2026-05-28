import type { SearchApiError } from "@/features/search/api";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";

export function SearchError({ error }: { error: SearchApiError }) {
    const resolveApiError = useApiErrorMessage();
    const msg = resolveApiError(error);
    const upstreamStatus = error.upstream?.status;
    const fieldEntries = error.fields ? Object.entries(error.fields).filter(([k]) => k !== "_") : [];
    return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm">
            <div className="font-medium">
                {error.code}
                {upstreamStatus !== undefined && ` · Pixiv ${upstreamStatus}`}
            </div>
            <div className="text-destructive/90">{msg}</div>
            {fieldEntries.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-destructive/80 text-xs">
                    {fieldEntries.map(([key, value]) => (
                        <li key={key}>
                            <span className="font-mono">{key}</span>: {value}
                        </li>
                    ))}
                </ul>
            )}
            {error.request_id && <div className="mt-1 text-destructive/60 text-xs">request id: {error.request_id}</div>}
        </div>
    );
}

export function SearchNoResults({ word }: { word: string }) {
    const m = useMessages();
    return (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="font-medium text-foreground text-lg">{m.search_no_results_title({ word })}</div>
            <div className="text-muted-foreground text-sm">{m.search_no_results_hint()}</div>
        </div>
    );
}
