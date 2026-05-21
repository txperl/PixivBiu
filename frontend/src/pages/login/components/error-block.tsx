import type { AuthApiError } from "@/features/auth/api";
import { humanizeAuthError } from "@/features/auth/utils";
import { cn } from "@/lib/utils";

export function ErrorBlock({ error, className }: { error: AuthApiError; className?: string }) {
    const message = humanizeAuthError(error.message) ?? error.message;
    const detail = humanizeAuthError(error.detail);
    return (
        <div
            className={cn(
                "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm",
                className,
            )}
        >
            <div className="font-medium">{error.code}</div>
            <div className="text-destructive/90">{message}</div>
            {detail && <div className="mt-0.5 break-all text-destructive/70 text-xs">{detail}</div>}
        </div>
    );
}
