import { HugeiconsIcon } from "@hugeicons/react";
import { type MouseEvent, useRef, useState } from "react";
import Avatar from "@/components/avatar";
import PximgImage from "@/components/pximg-image";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Illust } from "@/features/search/api";
import IllustPlaceholderArt from "@/features/search/components/illust-placeholder-art";
import { formatCount, hueFromId } from "@/lib/format";
import { HeartIcon, PagesIcon } from "@/lib/icons";

type IllustCardProps = {
    illust: Illust;
};

const MAX_DOTS = 10;
const PREVIEW_SIDE = "min(75vw, 75vh)";

function IllustCard({ illust }: IllustCardProps) {
    const hue = hueFromId(illust.id);

    const isWide = illust.width >= illust.height;
    const aspect = illust.width > 0 && illust.height > 0 ? illust.width / illust.height : 1;

    const allPages =
        illust.page_count > 1 && illust.meta_pages.length > 0
            ? illust.meta_pages.map((p, i) => ({ key: i, src: p.image_urls.large }))
            : [{ key: 0, src: illust.image_urls.large }];
    const totalPages = allPages.length;
    const displayedDots = Math.min(totalPages, MAX_DOTS);

    const [open, setOpen] = useState(false);
    const [activePage, setActivePage] = useState(0);
    const activePageRef = useRef(0);

    const updateActivePage = (e: MouseEvent<HTMLElement>) => {
        if (totalPages <= 1) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const idx = Math.min(totalPages - 1, Math.floor(pos * totalPages));
        if (idx === activePageRef.current) return;
        activePageRef.current = idx;
        setActivePage(idx);
    };

    const activeDot = Math.min(displayedDots - 1, Math.floor((activePage / totalPages) * displayedDots));

    return (
        <div className="group relative cursor-pointer overflow-hidden rounded-2xl bg-card transition-colors">
            <div className="relative p-2">
                <PximgImage
                    src={illust.image_urls.square_medium}
                    alt={illust.title}
                    fallback={<IllustPlaceholderArt hue={hue} ratio="1/1" rounded={12} />}
                    className="aspect-square w-full rounded-xl object-cover"
                />

                <div className="pointer-events-none absolute inset-2 rounded-xl bg-black/[0.04] opacity-0 transition-opacity group-hover:opacity-100" />

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
                                className="flex cursor-default items-center gap-1 rounded-full bg-[rgba(30,20,15,0.7)] px-2 py-1.5 outline-none backdrop-blur-sm"
                                onMouseEnter={(e) => {
                                    updateActivePage(e);
                                    setOpen(true);
                                }}
                                onMouseLeave={() => setOpen(false)}
                                onMouseMove={updateActivePage}
                            >
                                {allPages.slice(0, displayedDots).map((page, i) => (
                                    <span
                                        key={page.key}
                                        className={`block h-1.5 w-1.5 rounded-full transition-colors ${
                                            open && i === activeDot ? "bg-white" : "bg-white/55"
                                        }`}
                                    />
                                ))}
                            </PopoverTrigger>
                            <PopoverContent side="right" sideOffset={8} className="w-auto p-1.5">
                                <div
                                    className="relative overflow-hidden rounded-md bg-muted"
                                    style={{
                                        aspectRatio: aspect,
                                        width: isWide ? PREVIEW_SIDE : undefined,
                                        height: isWide ? undefined : PREVIEW_SIDE,
                                    }}
                                >
                                    <PximgImage
                                        key={allPages[activePage].src}
                                        src={allPages[activePage].src}
                                        alt={illust.title}
                                        fallback={<IllustPlaceholderArt hue={hue} ratio="1/1" rounded={6} />}
                                        className="block h-full w-full object-cover"
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
            </div>

            <div className="px-3.5 pt-1 pb-3.5">
                <div className="truncate font-medium text-foreground text-sm" title={illust.title}>
                    {illust.title}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Avatar hue={hueFromId(illust.user.id)} initial={illust.user.name[0] ?? "?"} size={18} />
                    <span className="flex-1 truncate" title={illust.user.name}>
                        {illust.user.name}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono">
                        <HugeiconsIcon icon={HeartIcon} size={11} strokeWidth={1.5} />
                        {formatCount(illust.total_bookmarks)}
                    </span>
                </div>
            </div>
        </div>
    );
}

export default IllustCard;
