import type { AuthApiError } from "@/features/auth/api";
import { useApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ErrorBlock({ error, className }: { error: AuthApiError; className?: string }) {
    const resolveApiError = useApiErrorMessage();
    const message = resolveApiError(error);
    const upstreamStatus = error.upstream?.status;
    return (
        <div
            className={cn(
                "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm",
                className,
            )}
        >
            <div className="font-medium">
                {error.code}
                {upstreamStatus !== undefined && ` · Pixiv ${upstreamStatus}`}
            </div>
            <div className="text-destructive/90">{message}</div>
            {error.request_id && (
                <div className="mt-0.5 break-all text-destructive/70 text-xs">request id: {error.request_id}</div>
            )}
        </div>
    );
}
