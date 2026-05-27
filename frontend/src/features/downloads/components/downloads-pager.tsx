import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/i18n";
import { ChevronLeftIcon, ChevronRightIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type DownloadsPagerProps = {
    currentPage: number;
    totalPages: number;
    onJump: (page: number) => void;
};

type PageItem = { kind: "page"; page: number } | { kind: "ellipsis"; key: string };

function buildPageList(currentPage: number, totalPages: number): PageItem[] {
    const anchors = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
    const pages = [...anchors].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    const out: PageItem[] = [];
    for (let i = 0; i < pages.length; i++) {
        if (i > 0 && pages[i] - pages[i - 1] > 1) {
            out.push({ kind: "ellipsis", key: `gap-${pages[i - 1]}-${pages[i]}` });
        }
        out.push({ kind: "page", page: pages[i] });
    }
    return out;
}

function DownloadsPager({ currentPage, totalPages, onJump }: DownloadsPagerProps) {
    const m = useMessages();
    const items = buildPageList(currentPage, totalPages);

    return (
        <nav className="flex items-center justify-center gap-1 pt-2 pb-4">
            <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={currentPage <= 1}
                onClick={() => onJump(currentPage - 1)}
                aria-label={m.common_prev_page()}
            >
                <HugeiconsIcon icon={ChevronLeftIcon} size={16} strokeWidth={1.5} />
            </Button>

            {items.map((item) => {
                if (item.kind === "ellipsis") {
                    return (
                        <span
                            key={item.key}
                            aria-hidden="true"
                            className="inline-flex h-8 min-w-8 select-none items-center justify-center font-mono text-muted-foreground text-sm"
                        >
                            …
                        </span>
                    );
                }
                const isCurrent = item.page === currentPage;
                return (
                    <Button
                        key={item.page}
                        type="button"
                        variant={isCurrent ? "default" : "ghost"}
                        onClick={() => onJump(item.page)}
                        className={cn("min-w-8 font-mono", !isCurrent && "text-muted-foreground")}
                        aria-current={isCurrent ? "page" : undefined}
                        aria-label={m.downloads_page_label({ page: item.page })}
                    >
                        {item.page}
                    </Button>
                );
            })}

            <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={currentPage >= totalPages}
                onClick={() => onJump(currentPage + 1)}
                aria-label={m.common_next_page()}
            >
                <HugeiconsIcon icon={ChevronRightIcon} size={16} strokeWidth={1.5} />
            </Button>
        </nav>
    );
}

export default DownloadsPager;
