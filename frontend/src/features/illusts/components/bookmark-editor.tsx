import { type ComponentProps, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { PopoverContent, PopoverTitle } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/features/auth";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Illust } from "../api";
import { normalizeBookmarkTags } from "../bookmark-state";
import { useBookmarkEditor } from "../use-bookmark-editor";
import { useBookmarkTags } from "../use-bookmark-tags";
import type { IllustBookmark } from "../use-illust-bookmark";
import { BookmarkStatusOptions } from "./bookmark-status-options";
import { BookmarkTagChecklist } from "./bookmark-tag-checklist";

function BookmarkEditorForm({ bookmark, illust }: { bookmark: IllustBookmark; illust: Illust }) {
    const m = useMessages();
    const { status } = useAuth();
    const resolveError = useApiErrorMessage();
    const detail = bookmark.detailQuery;
    const editor = useBookmarkEditor(bookmark);
    const publicTags = useBookmarkTags(status?.user_id, "public");
    const privateTags = useBookmarkTags(status?.user_id, "private");
    const suggestions = useMemo(
        () => normalizeBookmarkTags([...publicTags.entries, ...privateTags.entries].map((tag) => tag.name)),
        [publicTags.entries, privateTags.entries],
    );
    const catalogLoading = publicTags.isFetching || privateTags.isFetching;
    const catalogError = publicTags.isError || privateTags.isError;
    const readError = detail.isError && (
        <div role="alert" className="space-y-2 px-3 py-2 text-xs">
            <p className="text-destructive">
                {m.bookmark_load_error()}: {resolveError(detail.error)}
            </p>
            <Button size="sm" variant="outline" onClick={() => void detail.refetch()}>
                {m.bookmark_retry()}
            </Button>
        </div>
    );
    const catalogStatus = catalogError && (
        <p className="px-3 py-2 text-muted-foreground text-xs">
            {m.bookmark_tags_error()}{" "}
            <button
                type="button"
                className="underline"
                onClick={() => {
                    void publicTags.refetch();
                    void privateTags.refetch();
                }}
            >
                {m.bookmark_retry()}
            </button>
        </p>
    );
    const canLoadMore = (publicTags.hasNextPage || privateTags.hasNextPage) && !catalogLoading && !catalogError;
    const loadNextTags = () =>
        Promise.all([
            publicTags.hasNextPage ? publicTags.fetchNextPage({ cancelRefetch: false }) : undefined,
            privateTags.hasNextPage ? privateTags.fetchNextPage({ cancelRefetch: false }) : undefined,
        ]);
    return (
        <ScrollArea className="min-h-0 flex-1">
            <div data-app-controls="">
                <BookmarkTagChecklist
                    values={editor.values}
                    suggestions={suggestions}
                    artworkTags={illust.tags.map((tag) => tag.name)}
                    disabled={editor.tagsDisabled}
                    loading={editor.loading || catalogLoading}
                    saving={editor.saving}
                    status={
                        readError || catalogError || bookmark.errorTitle ? (
                            <>
                                {readError}
                                {catalogStatus}
                                {bookmark.errorTitle && (
                                    <p role="alert" className="px-3 py-2 text-destructive text-xs">
                                        {bookmark.errorTitle}
                                    </p>
                                )}
                            </>
                        ) : undefined
                    }
                    canLoadMore={canLoadMore}
                    onLoadMore={loadNextTags}
                    onChange={editor.changeTags}
                />
                <BookmarkStatusOptions state={editor.status} onChange={editor.changeStatus} />
            </div>
        </ScrollArea>
    );
}

export function BookmarkEditorContent({
    bookmark,
    illust,
    open,
    className,
    onClick,
    ...props
}: Omit<ComponentProps<typeof PopoverContent>, "children"> & {
    bookmark: IllustBookmark;
    illust: Illust;
    open: boolean;
}) {
    const m = useMessages();
    return (
        <PopoverContent
            {...props}
            aria-label={m.bookmark_tags_title()}
            className={cn(
                "max-h-[min(var(--available-height),calc(var(--window-content-height)*0.85))] w-72 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0",
                className,
            )}
            onClick={(event) => {
                event.stopPropagation();
                onClick?.(event);
            }}
        >
            <PopoverTitle className="sr-only">{m.bookmark_tags_title()}</PopoverTitle>
            {open && <BookmarkEditorForm bookmark={bookmark} illust={illust} />}
        </PopoverContent>
    );
}
