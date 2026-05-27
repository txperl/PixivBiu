import { HugeiconsIcon } from "@hugeicons/react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addBookmark, deleteBookmark, getBookmarkDetail, type Restrict } from "@/features/illusts/api";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { HeartIcon, MagnetIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

const RESTRICT_ICONS: Record<Restrict, typeof MagnetIcon> = {
    private: MagnetIcon,
    public: HeartIcon,
};

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
    const m = useMessages();
    const resolveApiError = useApiErrorMessage();
    const restrictOptions = [
        { value: "private", icon: RESTRICT_ICONS.private, label: m.search_bookmark_private() },
        { value: "public", icon: RESTRICT_ICONS.public, label: m.search_bookmark_public() },
    ] as const satisfies ReadonlyArray<{ value: Restrict; icon: unknown; label: string }>;
    const [bookmarked, setBookmarked] = useState(initialIsBookmarked);
    const [count, setCount] = useState(initialBookmarkCount);
    const [pending, setPending] = useState(false);
    const [errorTitle, setErrorTitle] = useState<string | null>(null);
    const [popoverOpen, setPopoverOpen] = useState(false);
    // null = unknown (either not bookmarked, or bookmarked but detail not yet fetched).
    const [currentRestrict, setCurrentRestrict] = useState<Restrict | null>(null);
    const [restrictLoading, setRestrictLoading] = useState(false);
    const [popVersion, setPopVersion] = useState(0);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Bumped on each add/delete; lazy-fetch results from a stale generation are discarded.
    const opGenRef = useRef(0);

    useEffect(
        () => () => {
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        },
        [],
    );

    const openPopover = () => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        setPopoverOpen(true);
        if (bookmarked && currentRestrict === null && !restrictLoading) {
            const myGen = opGenRef.current;
            setRestrictLoading(true);
            getBookmarkDetail(illustId).then(({ data, error }) => {
                if (opGenRef.current === myGen && !error && data?.is_bookmarked) {
                    setCurrentRestrict(data.restrict);
                }
                setRestrictLoading(false);
            });
        }
    };

    // Bridge the gap between trigger button and popover so cursor transit doesn't dismiss it.
    const scheduleClose = () => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => setPopoverOpen(false), 120);
    };

    const runAdd = async (restrict: Restrict) => {
        if (pending) return;
        opGenRef.current++;
        const wasBookmarked = bookmarked;
        const wasCount = count;
        const wasRestrict = currentRestrict;
        setBookmarked(true);
        setCurrentRestrict(restrict);
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
            setCurrentRestrict(wasRestrict);
            setErrorTitle(resolveApiError(error));
        }
        setPending(false);
    };

    const runDelete = async () => {
        if (pending) return;
        opGenRef.current++;
        const wasBookmarked = bookmarked;
        const wasCount = count;
        const wasRestrict = currentRestrict;
        setBookmarked(false);
        setCurrentRestrict(null);
        setCount(Math.max(0, wasCount - 1));
        setPending(true);
        setErrorTitle(null);
        const { error } = await deleteBookmark(illustId);
        if (error) {
            setBookmarked(wasBookmarked);
            setCount(wasCount);
            setCurrentRestrict(wasRestrict);
            setErrorTitle(resolveApiError(error));
        }
        setPending(false);
    };

    const onClick = (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (bookmarked) runDelete();
        else runAdd("public");
    };

    const pickRestrict = (restrict: Restrict) => {
        if (pending) return;
        if (bookmarked && currentRestrict === restrict) return;
        runAdd(restrict);
    };

    const button = (
        <button
            ref={buttonRef}
            type="button"
            onClick={onClick}
            onMouseEnter={openPopover}
            onMouseLeave={scheduleClose}
            disabled={pending}
            aria-pressed={bookmarked}
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
                    icon={bookmarked && currentRestrict === "private" ? MagnetIcon : HeartIcon}
                    size={11}
                    strokeWidth={1.5}
                    fill={bookmarked ? "currentColor" : "none"}
                />
            </span>
            {formatCount(count)}
        </button>
    );

    return (
        <>
            {errorTitle ? (
                <Tooltip>
                    <TooltipTrigger render={button} />
                    <TooltipContent>{errorTitle}</TooltipContent>
                </Tooltip>
            ) : (
                button
            )}
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverContent
                    anchor={buttonRef}
                    side="top"
                    align="end"
                    sideOffset={6}
                    className="w-auto p-1"
                    initialFocus={false}
                    finalFocus={false}
                    onMouseEnter={openPopover}
                    onMouseLeave={scheduleClose}
                >
                    <div className="flex flex-col gap-1">
                        {restrictOptions.map(({ value, icon, label }) =>
                            restrictLoading ? (
                                <Skeleton key={value} className="h-7 min-w-15 rounded-md" />
                            ) : (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => pickRestrict(value)}
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
                </PopoverContent>
            </Popover>
        </>
    );
}

export default IllustBookmarkButton;
