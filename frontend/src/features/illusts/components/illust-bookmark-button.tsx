import { HugeiconsIcon } from "@hugeicons/react";
import { type MouseEvent, useRef, useState } from "react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { addBookmark, deleteBookmark, type Restrict } from "@/features/illusts/api";
import { apiErrorMessage } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { HeartIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type IllustBookmarkButtonProps = {
    illustId: number;
    initialIsBookmarked: boolean;
    initialBookmarkCount: number;
    className?: string;
};

function IllustBookmarkButton({
    illustId,
    initialIsBookmarked,
    initialBookmarkCount,
    className,
}: IllustBookmarkButtonProps) {
    const [bookmarked, setBookmarked] = useState(initialIsBookmarked);
    const [count, setCount] = useState(initialBookmarkCount);
    const [pending, setPending] = useState(false);
    const [errorTitle, setErrorTitle] = useState<string | null>(null);
    const [popoverOpen, setPopoverOpen] = useState(false);
    // Bumped on each fresh bookmark to retrigger the pop animation via React key.
    const [popVersion, setPopVersion] = useState(0);
    const buttonRef = useRef<HTMLButtonElement | null>(null);

    const runAdd = async (restrict: Restrict) => {
        if (pending) return;
        const wasBookmarked = bookmarked;
        const wasCount = count;
        setBookmarked(true);
        if (!wasBookmarked) {
            setCount(wasCount + 1);
            setPopVersion((v) => v + 1);
        }
        setPending(true);
        setErrorTitle(null);
        const { error } = await addBookmark(illustId, restrict);
        if (error) {
            setBookmarked(wasBookmarked);
            setCount(wasCount);
            setErrorTitle(apiErrorMessage(error));
        }
        setPending(false);
    };

    const runDelete = async () => {
        if (pending) return;
        const wasBookmarked = bookmarked;
        const wasCount = count;
        setBookmarked(false);
        setCount(Math.max(0, wasCount - 1));
        setPending(true);
        setErrorTitle(null);
        const { error } = await deleteBookmark(illustId);
        if (error) {
            setBookmarked(wasBookmarked);
            setCount(wasCount);
            setErrorTitle(apiErrorMessage(error));
        }
        setPending(false);
    };

    const onClick = (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (bookmarked) runDelete();
        else runAdd("public");
    };

    const onContextMenu = (e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setPopoverOpen(true);
    };

    const pickRestrict = (restrict: Restrict) => {
        if (pending) return;
        runAdd(restrict);
    };

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={onClick}
                onContextMenu={onContextMenu}
                disabled={pending}
                aria-pressed={bookmarked}
                title={errorTitle ?? "右键切换公开/私密收藏"}
                className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 font-mono outline-none disabled:cursor-wait disabled:opacity-70",
                    bookmarked ? "text-rose-500" : "text-muted-foreground hover:text-rose-500/70",
                    errorTitle && "ring-1 ring-destructive/40",
                    className,
                )}
            >
                <span
                    key={popVersion}
                    className={cn(
                        "inline-flex origin-center transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-rotate-6 group-hover:scale-125",
                        popVersion > 0 && "animate-bookmark-pop",
                    )}
                >
                    <HugeiconsIcon
                        icon={HeartIcon}
                        size={11}
                        strokeWidth={1.5}
                        fill={bookmarked ? "currentColor" : "none"}
                    />
                </span>
                {formatCount(count)}
            </button>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverContent anchor={buttonRef} side="top" align="end" sideOffset={6} className="w-auto p-1">
                    <div className="flex gap-1">
                        {(["public", "private"] as const).map((r) => (
                            <button
                                key={r}
                                type="button"
                                onClick={() => pickRestrict(r)}
                                disabled={pending}
                                className="min-w-14 cursor-pointer rounded-md px-3 py-1.5 text-center text-muted-foreground text-xs transition-colors hover:bg-secondary/60 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
                            >
                                {r === "public" ? "公开" : "私密"}
                            </button>
                        ))}
                    </div>
                </PopoverContent>
            </Popover>
        </>
    );
}

export default IllustBookmarkButton;
