import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMessages } from "@/i18n";
import { TagIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { Illust } from "../api";
import type { IllustBookmark } from "../use-illust-bookmark";
import { BookmarkEditorContent } from "./bookmark-editor";
import { BookmarkRestrictOptions } from "./bookmark-restrict-options";

// Keep the heart's click semantics. Hover (or ArrowDown) opens the original
// visibility chooser; the nested popover can hold a form without menu key handlers.
export function BookmarkPopover({
    bookmark,
    illust,
    align = "end",
    sideOffset = 6,
}: {
    bookmark: IllustBookmark;
    illust: Illust;
    align?: "center" | "end";
    sideOffset?: number;
}) {
    const m = useMessages();
    const [pinned, setPinned] = useState(false);
    return (
        <Popover
            open={bookmark.popoverOpen}
            onOpenChange={(open, details) => {
                if (
                    !open &&
                    bookmark.quickEditorOpen &&
                    (details.reason === "trigger-hover" || details.reason === "focus-out")
                ) {
                    details.cancel();
                    return;
                }
                bookmark.setPopoverOpen(open);
                if (!open) bookmark.setQuickEditorOpen(false);
            }}
        >
            <PopoverContent
                ref={bookmark.popoverRef}
                anchor={bookmark.buttonRef}
                side="top"
                align={align}
                sideOffset={sideOffset}
                initialFocus={bookmark.keyboardPopover}
                finalFocus={bookmark.keyboardPopover ? bookmark.buttonRef : false}
                aria-label={m.bookmark_more()}
                className={cn("w-auto gap-1 p-1", bookmark.quickEditorOpen && "ring-primary/20")}
                onMouseEnter={bookmark.keepPopoverOpen}
                onMouseMove={bookmark.keepPopoverOpen}
                onMouseLeave={bookmark.scheduleClose}
                onClick={(event) => event.stopPropagation()}
            >
                <Popover
                    open={bookmark.quickEditorOpen}
                    onOpenChange={(open, details) => {
                        if (
                            !open &&
                            details.reason !== "imperative-action" &&
                            pinned &&
                            (details.reason === "trigger-hover" || details.reason === "focus-out")
                        ) {
                            details.cancel();
                            return;
                        }
                        if (open && !bookmark.quickEditorOpen) setPinned(false);
                        bookmark.setQuickEditorOpen(open);
                        if (!open) bookmark.scheduleClose();
                    }}
                >
                    <PopoverTrigger
                        openOnHover
                        delay={100}
                        closeDelay={200}
                        disabled={bookmark.pending}
                        className="inline-flex min-w-15 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-muted-foreground text-xs outline-none hover:bg-secondary/60 hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground data-popup-open:bg-secondary/60 data-popup-open:text-foreground"
                        onKeyDown={(event) => {
                            if (event.key !== "ArrowRight") return;
                            event.preventDefault();
                            bookmark.setQuickEditorOpen(true);
                        }}
                    >
                        <HugeiconsIcon icon={TagIcon} size={12} />
                        {m.bookmark_edit_tags()}
                    </PopoverTrigger>
                    <BookmarkEditorContent
                        bookmark={bookmark}
                        illust={illust}
                        open={bookmark.quickEditorOpen}
                        side="right"
                        align="end"
                        sideOffset={8}
                        initialFocus={bookmark.keyboardPopover}
                        finalFocus={bookmark.keyboardPopover}
                        onFocusCapture={() => setPinned(true)}
                        onPointerDownCapture={() => setPinned(true)}
                        onMouseEnter={bookmark.keepPopoverOpen}
                    />
                </Popover>
                <div className="mx-1 my-0.5 h-px bg-border/60" />
                <BookmarkRestrictOptions
                    currentRestrict={bookmark.currentRestrict}
                    restrictLoading={bookmark.restrictLoading}
                    pending={bookmark.pending}
                    onPick={bookmark.pickRestrict}
                />
            </PopoverContent>
        </Popover>
    );
}
