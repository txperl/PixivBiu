import { Combobox } from "@base-ui/react/combobox";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { Restrict } from "@/features/illusts/api";
import { BookmarkTagScrollArea } from "@/features/illusts/components/bookmark-tag-scroll-area";
import { useBookmarkTags } from "@/features/illusts/use-bookmark-tags";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { formatCount } from "@/lib/format";
import { ChevronDownIcon, LoaderIcon, RefreshIcon, SearchIcon, TagIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type TagItem = { name: string; count?: number | null; exact?: boolean };

export default function BookmarkTagDirectory({
    userId,
    restrict,
    selected,
    total,
    onSelect,
}: {
    userId: number;
    restrict: Restrict;
    selected: string;
    total?: number;
    onSelect: (tag: string) => void;
}) {
    const m = useMessages();
    const errorMessage = useApiErrorMessage();
    const query = useBookmarkTags(userId, restrict);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [highlighted, setHighlighted] = useState<TagItem>();
    const popupRef = useRef<HTMLDivElement | null>(null);
    const catalog: TagItem[] = [{ name: "", count: total }, ...query.entries];
    if (selected && !catalog.some((tag) => tag.name === selected))
        catalog.splice(1, 0, { name: selected, count: null });
    const current = catalog.find((tag) => tag.name === selected) ?? catalog[0];
    const exact = search.trim();
    const items = exact
        ? catalog.filter((tag) =>
              (tag.name || m.bookmark_all()).toLocaleLowerCase().includes(exact.toLocaleLowerCase()),
          )
        : catalog;
    if (exact && !catalog.some((tag) => tag.name === exact)) items.push({ name: exact, count: null, exact: true });
    const choose = (name: string) => {
        onSelect(name);
        setOpen(false);
        setSearch("");
    };
    return (
        <div data-bookmark-tag-picker="" className="min-w-0" data-app-controls="">
            <Popover
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) setSearch("");
                }}
            >
                <PopoverTrigger
                    render={
                        <Button
                            variant="outline"
                            size="sm"
                            className="max-w-full gap-2"
                            aria-label={m.bookmark_choose_tag({ tag: selected || m.bookmark_all() })}
                            title={selected || m.bookmark_all()}
                        />
                    }
                >
                    <HugeiconsIcon icon={TagIcon} size={14} className="text-muted-foreground" />
                    <span className="max-w-40 truncate">{selected || m.bookmark_all()}</span>
                    <span className="min-w-[2ch] text-right text-muted-foreground text-xs tabular-nums">
                        {formatCount(current.count ?? 0)}
                    </span>
                    <HugeiconsIcon icon={ChevronDownIcon} size={14} className="text-muted-foreground" />
                </PopoverTrigger>
                <PopoverContent
                    ref={popupRef}
                    align="start"
                    sideOffset={6}
                    initialFocus={popupRef}
                    tabIndex={-1}
                    aria-label={m.bookmark_browse_tags()}
                    className="w-64 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
                >
                    <PopoverTitle className="sr-only">{m.bookmark_browse_tags()}</PopoverTitle>
                    <Combobox.Root<TagItem>
                        inline
                        open={open}
                        items={items}
                        filter={null}
                        value={current}
                        inputValue={search}
                        onInputValueChange={setSearch}
                        itemToStringLabel={(item) => item.name || m.bookmark_all()}
                        isItemEqualToValue={(a, b) => a.name === b.name}
                        onItemHighlighted={setHighlighted}
                        onValueChange={(item) => {
                            if (item) choose(item.name);
                        }}
                    >
                        <div className="flex h-48 flex-col">
                            <BookmarkTagScrollArea
                                className="min-h-0 flex-1"
                                canLoadMore={
                                    open && !exact && !!query.hasNextPage && !query.isFetching && !query.isError
                                }
                                onLoadMore={() => query.fetchNextPage({ cancelRefetch: false })}
                            >
                                <Combobox.List aria-label={m.bookmark_browse_tags()}>
                                    {(item: TagItem) => (
                                        <Combobox.Item
                                            value={item}
                                            key={item.name}
                                            className={cn(
                                                "group/tag flex cursor-default select-none items-center gap-3 px-3 py-1.5 text-sm outline-none data-highlighted:bg-muted/50",
                                                "data-[selected]:data-highlighted:bg-primary/15 data-[selected]:bg-primary/10 data-[selected]:text-primary data-[selected]:shadow-[inset_2px_0_0_var(--primary)]",
                                            )}
                                        >
                                            <span className="min-w-0 flex-1 truncate group-data-[selected]/tag:font-medium">
                                                {item.exact
                                                    ? m.bookmark_view_tag({ tag: item.name })
                                                    : item.name || m.bookmark_all()}
                                            </span>
                                            <span className="min-w-[2ch] shrink-0 text-right text-muted-foreground text-xs tabular-nums group-data-[selected]/tag:text-primary">
                                                {formatCount(item.count ?? 0)}
                                            </span>
                                        </Combobox.Item>
                                    )}
                                </Combobox.List>
                                {query.isPending && (
                                    <p role="status" className="px-3 py-2 text-muted-foreground text-xs">
                                        {m.bookmark_loading()}
                                    </p>
                                )}
                                {query.isSuccess &&
                                    !query.hasNextPage &&
                                    query.entries.length === 0 &&
                                    !selected &&
                                    !search && (
                                        <p className="px-3 py-2 text-muted-foreground text-xs">
                                            {m.bookmark_no_tags()}
                                        </p>
                                    )}
                            </BookmarkTagScrollArea>
                            {query.isError && (
                                <p
                                    role="alert"
                                    className="shrink-0 border-border/60 border-t px-3 py-2 text-destructive text-xs"
                                >
                                    {m.bookmark_tags_error()}: {errorMessage(query.error)}{" "}
                                    <button type="button" className="underline" onClick={() => void query.refetch()}>
                                        {m.bookmark_retry()}
                                    </button>
                                </p>
                            )}
                        </div>
                        <div className="flex items-center border-border/60 border-t transition-colors focus-within:border-ring">
                            <div className="relative min-w-0 flex-1">
                                <HugeiconsIcon
                                    icon={SearchIcon}
                                    size={14}
                                    className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                                />
                                <Combobox.Input
                                    render={
                                        <Input className="h-9 rounded-none border-0 pr-2 pl-[2.375rem] focus-visible:bg-muted/30 focus-visible:ring-0" />
                                    }
                                    aria-label={m.bookmark_search_tags()}
                                    placeholder={m.bookmark_search_placeholder()}
                                    onKeyDown={(event) => {
                                        if (
                                            event.key !== "Enter" ||
                                            event.nativeEvent.isComposing ||
                                            event.keyCode === 229 ||
                                            !exact ||
                                            highlighted
                                        )
                                            return;
                                        event.preventDefault();
                                        choose(exact);
                                    }}
                                />
                            </div>
                            <Button
                                variant="ghost"
                                size="icon-lg"
                                className="rounded-none focus-visible:ring-inset"
                                aria-label={m.bookmark_refresh()}
                                disabled={query.isFetching}
                                onClick={() => void query.refetch()}
                            >
                                <HugeiconsIcon
                                    icon={query.isFetching ? LoaderIcon : RefreshIcon}
                                    size={14}
                                    className={cn(query.isFetching && "animate-spin")}
                                />
                            </Button>
                        </div>
                    </Combobox.Root>
                    {query.isFetching && !query.isPending && (
                        <span role="status" className="sr-only">
                            {m.bookmark_refreshing()}
                        </span>
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
}
