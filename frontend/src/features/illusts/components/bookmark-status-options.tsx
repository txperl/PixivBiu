import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import type { BookmarkStatus, BookmarkStatusState } from "../bookmark-state";

export function BookmarkStatusOptions({
    state,
    onChange,
}: {
    state: BookmarkStatusState;
    onChange: (value: BookmarkStatus) => void;
}) {
    const m = useMessages();
    const loading = state.phase === "loading";
    const value = state.phase === "ready" ? state.value : null;
    const disabled = state.phase !== "ready" || state.disabled;
    const labels = {
        none: m.bookmark_unbookmarked,
        public: m.bookmark_public,
        private: m.bookmark_private,
    };
    return (
        <div className="flex items-center justify-between gap-2 border-border/60 border-t px-3 py-2">
            <span className="shrink-0 text-muted-foreground text-xs">{m.bookmark_status_short()}</span>
            <ToggleGroup
                value={value == null ? [] : [value]}
                disabled={disabled}
                aria-busy={loading || undefined}
                aria-label={m.bookmark_status()}
                aria-hidden={loading || undefined}
                className="grid shrink-0 grid-cols-3 gap-0.5 rounded-lg bg-muted/50 p-0.5"
                onValueChange={(next, details) => {
                    const selected = next[0];
                    if (!selected || selected === value) {
                        details.cancel();
                        return;
                    }
                    onChange(selected);
                }}
            >
                {(["none", "public", "private"] as const).map((status) => (
                    <Toggle
                        key={status}
                        value={status}
                        className={cn(
                            buttonVariants({ variant: "ghost", size: "xs" }),
                            "min-w-13 px-1.5 font-normal text-muted-foreground disabled:opacity-100 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs",
                        )}
                    >
                        <span className="relative">
                            <span className={cn(loading && "invisible")}>{labels[status]()}</span>
                            {loading && (
                                <Skeleton
                                    aria-hidden="true"
                                    className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-foreground/10 motion-reduce:animate-none"
                                />
                            )}
                        </span>
                    </Toggle>
                ))}
            </ToggleGroup>
            {loading && <span role="status" aria-label={m.bookmark_status()} className="sr-only" />}
        </div>
    );
}
