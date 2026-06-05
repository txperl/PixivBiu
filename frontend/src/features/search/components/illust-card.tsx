import { HugeiconsIcon } from "@hugeicons/react";
import { type MouseEvent, useRef, useState } from "react";
import Avatar from "@/components/avatar";
import PximgImage from "@/components/pximg-image";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import IllustDownloadButton from "@/features/downloads/components/illust-download-button";
import type { Illust } from "@/features/search/api";
import IllustBookmarkButton from "@/features/search/components/illust-bookmark-button";
import IllustPlaceholderArt from "@/features/search/components/illust-placeholder-art";
import UserLink from "@/features/users/components/user-link";
import { hueFromId } from "@/lib/format";
import { CheckIcon, PagesIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type IllustCardProps = {
    illust: Illust;
    selected?: boolean;
    selectMode?: boolean;
    onSelect?: (id: number) => void;
};

const MAX_DOTS = 10;
const PREVIEW_SIDE = "min(75vw, 75vh)";

function IllustCard({ illust, selected = false, selectMode = false, onSelect }: IllustCardProps) {
    const selectable = onSelect != null;
    const selectActive = selectable && selectMode;
    const hue = hueFromId(illust.id);

    const fallbackAspect = illust.width > 0 && illust.height > 0 ? illust.width / illust.height : 1;

    const allPages =
        illust.page_count > 1 && illust.meta_pages.length > 0
            ? illust.meta_pages.map((p, i) => ({ key: i, src: p.image_urls.large }))
            : [{ key: 0, src: illust.image_urls.large }];
    const totalPages = allPages.length;
    const displayedDots = Math.min(totalPages, MAX_DOTS);

    const [open, setOpen] = useState(false);
    const [activePage, setActivePage] = useState(0);
    const activePageRef = useRef(0);
    const dotsRef = useRef<HTMLDivElement>(null);
    const [pageAspects, setPageAspects] = useState<Record<number, number>>({});

    const currentAspect = pageAspects[activePage] ?? fallbackAspect;
    const currentIsWide = currentAspect >= 1;

    const updateActivePage = (e: MouseEvent<HTMLElement>) => {
        if (totalPages <= 1) return;
        const el = dotsRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const pos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const idx = Math.min(totalPages - 1, Math.floor(pos * totalPages));
        if (idx === activePageRef.current) return;
        activePageRef.current = idx;
        setActivePage(idx);
    };

    const activeDot = Math.min(displayedDots - 1, Math.floor((activePage / totalPages) * displayedDots));

    return (
        <div
            className={cn(
                "group relative cursor-pointer overflow-hidden rounded-2xl bg-card transition-colors",
                selectable && selected && "outline outline-2 outline-primary -outline-offset-2",
            )}
        >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: role/tabIndex are paired with onClick via selectActive */}
            <div
                className="relative p-2"
                onClick={selectActive ? () => onSelect?.(illust.id) : undefined}
                onKeyDown={
                    selectActive
                        ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  onSelect?.(illust.id);
                              }
                          }
                        : undefined
                }
                role={selectActive ? "button" : undefined}
                tabIndex={selectActive ? 0 : undefined}
            >
                <PximgImage
                    src={illust.image_urls.square_medium}
                    alt={illust.title}
                    fallback={<IllustPlaceholderArt hue={hue} ratio="1/1" rounded={12} />}
                    className="aspect-square w-full rounded-xl object-cover"
                />

                <div className="pointer-events-none absolute inset-2 rounded-xl bg-black/4 opacity-0 transition-opacity group-hover:opacity-100" />

                {selectable && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect?.(illust.id);
                        }}
                        className={cn(
                            "absolute top-3.5 left-3.5 flex size-6 items-center justify-center rounded-md backdrop-blur-sm transition-opacity",
                            selected
                                ? "bg-primary text-primary-foreground opacity-100"
                                : cn(
                                      "border-2 border-white/95 bg-black/30 text-white",
                                      selectActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                                  ),
                        )}
                    >
                        {selected && <HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={2.5} />}
                    </button>
                )}

                <div className="pointer-events-none absolute top-3.5 right-3.5">
                    {illust.page_count > 1 && (
                        <div className="flex items-center gap-1 rounded-full bg-[rgba(30,20,15,0.7)] px-2 py-[3px] font-mono text-[10.5px] text-white backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-0">
                            <HugeiconsIcon icon={PagesIcon} size={11} strokeWidth={1.5} />
                            {illust.page_count}
                        </div>
                    )}

                    <div className="pointer-events-auto absolute top-0 right-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        <Popover open={open} onOpenChange={setOpen}>
                            <PopoverTrigger
                                render={<div />}
                                nativeButton={false}
                                aria-label={totalPages > 1 ? `Preview (${totalPages} pages)` : "Preview"}
                                className={cn(
                                    "flex cursor-default items-center rounded-full bg-[rgba(30,20,15,0.7)] px-2.5 py-2 outline-none backdrop-blur-sm",
                                    illust.page_count <= 1 && "px-2",
                                )}
                                onMouseEnter={(e) => {
                                    updateActivePage(e);
                                    setOpen(true);
                                }}
                                onMouseLeave={() => setOpen(false)}
                                onMouseMove={updateActivePage}
                            >
                                <div ref={dotsRef} className="flex items-center gap-1">
                                    {allPages.slice(0, displayedDots).map((page, i) => (
                                        <span
                                            key={page.key}
                                            className={cn(
                                                "block h-1.5 w-1.5 rounded-full transition-colors",
                                                open && i === activeDot ? "bg-white" : "bg-white/55",
                                            )}
                                        />
                                    ))}
                                </div>
                            </PopoverTrigger>
                            <PopoverContent side="right" sideOffset={8} className="w-auto p-1.5">
                                <div
                                    className="relative overflow-hidden rounded-md bg-muted"
                                    style={{
                                        aspectRatio: currentAspect,
                                        width: currentIsWide ? PREVIEW_SIDE : undefined,
                                        height: currentIsWide ? undefined : PREVIEW_SIDE,
                                    }}
                                >
                                    <PximgImage
                                        key={allPages[activePage].src}
                                        src={allPages[activePage].src}
                                        alt={illust.title}
                                        fallback={<IllustPlaceholderArt hue={hue} ratio="1/1" rounded={6} />}
                                        className="block h-full w-full object-cover"
                                        onLoad={(img) => {
                                            if (!img.naturalWidth || !img.naturalHeight) return;
                                            const ratio = img.naturalWidth / img.naturalHeight;
                                            setPageAspects((prev) =>
                                                prev[activePage] === ratio ? prev : { ...prev, [activePage]: ratio },
                                            );
                                        }}
                                    />
                                    {totalPages > 1 && (
                                        <div className="absolute top-2 right-2 rounded-full bg-[rgba(30,20,15,0.7)] px-2 py-[3px] font-mono text-[10.5px] text-white backdrop-blur-sm">
                                            {activePage + 1}/{totalPages}
                                        </div>
                                    )}
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>

                {selectable && <IllustDownloadButton illustId={illust.id} />}
            </div>

            <div className="px-3.5 pt-1 pb-3.5">
                <div className="truncate font-medium text-foreground text-sm">{illust.title}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-muted-foreground text-xs">
                    <UserLink userId={illust.user.id} className="flex min-w-0 flex-1 items-center gap-1.5">
                        <Avatar hue={hueFromId(illust.user.id)} initial={illust.user.name[0] ?? "?"} size={18} />
                        <span className="truncate hover:underline">{illust.user.name}</span>
                    </UserLink>
                    <IllustBookmarkButton
                        key={illust.id}
                        illustId={illust.id}
                        initialIsBookmarked={illust.is_bookmarked}
                        initialBookmarkCount={illust.total_bookmarks}
                    />
                </div>
            </div>
        </div>
    );
}

export default IllustCard;
