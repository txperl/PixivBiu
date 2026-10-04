import { HugeiconsIcon } from "@hugeicons/react";
import { useRef } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/features/auth";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { HeartIcon, MagnetIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { Illust } from "../api";
import { registeredBookmarkTags } from "../bookmark-state";
import { BookmarkNavigationReset, useIllustBookmark } from "../use-illust-bookmark";
import { BookmarkEditorContent } from "./bookmark-editor";

export function MyBookmark({ illust }: { illust: Illust }) {
    const m = useMessages();
    const { status } = useAuth();
    const navigate = useNavigate();
    const errorMessage = useApiErrorMessage();
    const editorRef = useRef<HTMLDivElement | null>(null);
    const bookmark = useIllustBookmark({
        illustId: illust.id,
        isBookmarked: illust.is_bookmarked,
        bookmarkCount: illust.total_bookmarks,
        loadDetail: true,
    });
    const query = bookmark.detailQuery;
    const tags = registeredBookmarkTags(query.data);
    const visibility = bookmark.currentRestrict;
    const visibilityLabel = visibility === "private" ? m.bookmark_private() : m.bookmark_public();
    const triggerLabel = !bookmark.bookmarked
        ? m.illust_action_bookmark()
        : visibility
          ? visibilityLabel
          : m.bookmark_edit_tags();
    const actionLabel = query.isPending
        ? m.bookmark_loading()
        : visibility
          ? m.bookmark_edit_visibility({ visibility: visibilityLabel })
          : triggerLabel;
    return (
        <section className="space-y-2 border-border/60 border-t pt-4" aria-label={m.bookmark_my_bookmark()}>
            <BookmarkNavigationReset illustId={illust.id} onNavigate={bookmark.resetEditors} />
            <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-sm">{m.bookmark_my_bookmark()}</h3>
                <Popover
                    open={bookmark.editorOpen}
                    onOpenChange={(open) => {
                        if (open) bookmark.openEditor();
                        else bookmark.setEditorOpen(false);
                    }}
                >
                    <Tooltip>
                        <PopoverTrigger
                            render={
                                <TooltipTrigger
                                    render={
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="relative font-normal text-muted-foreground disabled:opacity-100 aria-disabled:cursor-wait"
                                        />
                                    }
                                />
                            }
                            aria-label={actionLabel}
                            aria-busy={query.isPending || undefined}
                            disabled={query.isPending && !bookmark.editorOpen}
                            aria-disabled={bookmark.pending && !bookmark.editorOpen}
                        >
                            <HugeiconsIcon
                                aria-hidden="true"
                                icon={
                                    bookmark.bookmarked && bookmark.currentRestrict === "private"
                                        ? MagnetIcon
                                        : HeartIcon
                                }
                                size={16}
                                strokeWidth={1.8}
                                fill={bookmark.bookmarked ? "currentColor" : "none"}
                                className={cn(bookmark.bookmarked && "text-rose-500", query.isPending && "invisible")}
                            />
                            <span
                                className={cn(query.isPending && "invisible")}
                                aria-hidden={query.isPending || undefined}
                            >
                                {query.isPending
                                    ? illust.is_bookmarked
                                        ? m.bookmark_private()
                                        : m.illust_action_bookmark()
                                    : triggerLabel}
                            </span>
                            {query.isPending && (
                                <Skeleton className="absolute inset-0 rounded-[inherit]" aria-hidden="true" />
                            )}
                        </PopoverTrigger>
                        <TooltipContent>{actionLabel}</TooltipContent>
                    </Tooltip>
                    <BookmarkEditorContent
                        ref={editorRef}
                        bookmark={bookmark}
                        illust={illust}
                        open={bookmark.editorOpen}
                        align="end"
                        sideOffset={6}
                        initialFocus={editorRef}
                    />
                </Popover>
            </div>
            {query.isPending ? (
                <Skeleton className="h-6 w-12 rounded-full" aria-hidden="true" />
            ) : !query.data ? null : !bookmark.bookmarked ? (
                <p className="flex min-h-6 items-center text-muted-foreground text-xs">{m.bookmark_not_saved()}</p>
            ) : tags.length === 0 ? (
                <p className="flex min-h-6 items-center text-muted-foreground text-xs">
                    {m.bookmark_no_assigned_tags()}
                </p>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {tags.map((name) => (
                        <button
                            key={name}
                            type="button"
                            disabled={status?.user_id == null || bookmark.pending}
                            className="max-w-full truncate rounded-full bg-secondary px-2.5 py-1 text-secondary-foreground text-xs hover:bg-secondary/70 disabled:opacity-50"
                            onClick={() => {
                                if (status?.user_id == null) return;
                                const params = new URLSearchParams({
                                    tab: query.data?.restrict === "private" ? "bookmarks_private" : "bookmarks",
                                    tag: name,
                                });
                                navigate(`/user/${status.user_id}?${params}`);
                            }}
                        >
                            {name}
                        </button>
                    ))}
                </div>
            )}
            {query.isError && !bookmark.editorOpen && (
                <div role="alert" className="space-y-1 text-xs">
                    <p className="text-destructive">
                        {m.bookmark_load_error()}: {errorMessage(query.error)}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                        {m.bookmark_retry()}
                    </Button>
                </div>
            )}
        </section>
    );
}
