import { HugeiconsIcon } from "@hugeicons/react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Restrict } from "@/features/illusts/api";
import { useMessages } from "@/i18n";
import { HeartIcon, MagnetIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

const RESTRICT_ICONS: Record<Restrict, typeof MagnetIcon> = {
    private: MagnetIcon,
    public: HeartIcon,
};

// The public/private chooser rendered inside the bookmark popover, shared by the
// card button and the viewer action cell. The owning component supplies the
// Popover shell; this is just the option list (with a loading skeleton while the
// current restrict is fetched).
export function BookmarkRestrictOptions({
    currentRestrict,
    restrictLoading,
    pending,
    onPick,
}: {
    currentRestrict: Restrict | null;
    restrictLoading: boolean;
    pending: boolean;
    onPick: (restrict: Restrict) => void;
}) {
    const m = useMessages();
    const options = [
        { value: "private", icon: RESTRICT_ICONS.private, label: m.search_bookmark_private() },
        { value: "public", icon: RESTRICT_ICONS.public, label: m.search_bookmark_public() },
    ] as const satisfies ReadonlyArray<{ value: Restrict; icon: unknown; label: string }>;
    return (
        <div className="flex flex-col gap-1">
            {options.map(({ value, icon, label }) =>
                restrictLoading ? (
                    <Skeleton key={value} className="h-7 min-w-15 rounded-md" />
                ) : (
                    <button
                        key={value}
                        type="button"
                        onClick={() => onPick(value)}
                        disabled={pending}
                        className={cn(
                            "inline-flex min-w-15 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-colors disabled:cursor-wait disabled:opacity-60",
                            currentRestrict === value
                                ? "bg-secondary/60 text-foreground outline"
                                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                        )}
                    >
                        <HugeiconsIcon
                            icon={icon}
                            size={12}
                            strokeWidth={2}
                            className={cn(currentRestrict === value && "text-rose-500")}
                            fill={currentRestrict === value ? "currentColor" : "none"}
                        />
                        {label}
                    </button>
                ),
            )}
        </div>
    );
}
