import type { SearchApiError } from "@/features/search/api";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";

export function SearchError({ error }: { error: SearchApiError }) {
    const resolveApiError = useApiErrorMessage();
    const msg = resolveApiError(error);
    return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-destructive text-sm">
            <div className="font-medium">{error.code}</div>
            <div className="text-destructive/90">{msg}</div>
            {error.detail && <div className="mt-1 text-destructive/70 text-xs">{error.detail}</div>}
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
