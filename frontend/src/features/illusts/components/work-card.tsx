import { HugeiconsIcon } from "@hugeicons/react";
import Avatar from "@/components/avatar";
import { CheckIcon, DownloadIcon, HeartIcon, PagesIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { formatCount, type Work } from "../mock";
import PlaceholderArt from "./placeholder-art";

type WorkCardProps = {
    work: Work;
    selected: boolean;
    onSelect: () => void;
};

function WorkCard({ work, selected, onSelect }: WorkCardProps) {
    return (
        <div
            className={cn(
                "group relative cursor-pointer overflow-hidden rounded-2xl bg-card transition-colors",
                selected && "outline outline-2 outline-primary -outline-offset-2",
            )}
        >
            <div className="relative p-2">
                <PlaceholderArt hue={work.hue} ratio="1/1" rounded={12} />

                <div className="pointer-events-none absolute inset-2 rounded-xl bg-black/[0.04] opacity-0 transition-opacity group-hover:opacity-100" />

                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect();
                    }}
                    className={cn(
                        "absolute top-3.5 left-3.5 flex size-6 items-center justify-center rounded-md backdrop-blur-sm transition-opacity",
                        selected
                            ? "bg-primary text-primary-foreground opacity-100"
                            : "border-2 border-white/95 bg-black/30 text-white opacity-0 group-hover:opacity-100",
                    )}
                >
                    {selected && <HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={2.5} />}
                </button>

                {work.pages > 1 && (
                    <div className="absolute top-3.5 right-3.5 flex items-center gap-1 rounded-full bg-[rgba(30,20,15,0.7)] px-2 py-[3px] font-mono text-[10.5px] text-white backdrop-blur-sm">
                        <HugeiconsIcon icon={PagesIcon} size={11} strokeWidth={1.5} />
                        {work.pages}
                    </div>
                )}

                <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-3.5 bottom-3.5 flex size-10 scale-90 items-center justify-center rounded-xl bg-primary text-primary-foreground opacity-0 shadow-md transition-all group-hover:scale-100 group-hover:opacity-100"
                >
                    <HugeiconsIcon icon={DownloadIcon} size={16} strokeWidth={1.5} />
                </button>
            </div>

            <div className="px-3.5 pt-1 pb-3.5">
                <div className="truncate font-medium text-foreground text-sm">{work.title}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Avatar hue={work.author.hue} initial={work.author.name[0]} size={18} />
                    <span className="flex-1 truncate">{work.author.name}</span>
                    <span className="inline-flex items-center gap-1 font-mono">
                        <HugeiconsIcon icon={HeartIcon} size={11} strokeWidth={1.5} />
                        {formatCount(work.bookmarks)}
                    </span>
                </div>
            </div>
        </div>
    );
}

export default WorkCard;
