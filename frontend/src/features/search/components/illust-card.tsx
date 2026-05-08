import { HugeiconsIcon } from "@hugeicons/react";
import Avatar from "@/components/avatar";
import PximgImage from "@/components/pximg-image";
import PlaceholderArt from "@/features/illusts/components/placeholder-art";
import type { Illust } from "@/features/search/api";
import { formatCount, hueFromId } from "@/lib/format";
import { HeartIcon, PagesIcon } from "@/lib/icons";

type IllustCardProps = {
    illust: Illust;
};

function IllustCard({ illust }: IllustCardProps) {
    const hue = hueFromId(illust.id);

    return (
        <div className="group relative cursor-pointer overflow-hidden rounded-2xl bg-card transition-colors">
            <div className="relative p-2">
                <PximgImage
                    src={illust.image_urls.square_medium}
                    alt={illust.title}
                    fallback={<PlaceholderArt hue={hue} ratio="1/1" rounded={12} />}
                    className="aspect-square w-full rounded-xl object-cover"
                />

                <div className="pointer-events-none absolute inset-2 rounded-xl bg-black/[0.04] opacity-0 transition-opacity group-hover:opacity-100" />

                {illust.page_count > 1 && (
                    <div className="absolute top-3.5 right-3.5 flex items-center gap-1 rounded-full bg-[rgba(30,20,15,0.7)] px-2 py-[3px] font-mono text-[10.5px] text-white backdrop-blur-sm">
                        <HugeiconsIcon icon={PagesIcon} size={11} strokeWidth={1.5} />
                        {illust.page_count}
                    </div>
                )}
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
