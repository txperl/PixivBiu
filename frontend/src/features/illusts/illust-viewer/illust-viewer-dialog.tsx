import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { type Illust, illustDetailQueryOptions } from "@/features/illusts/api";
import { useMessages } from "@/i18n";
import { CloseIcon, ExternalLinkIcon } from "@/lib/icons";
import IllustInfo, { IllustEngagementFooter } from "./illust-info";
import IllustStage from "./illust-stage";

function ViewerContent({ illust }: { illust: Illust }) {
    return (
        <div className="flex h-full flex-col overflow-hidden md:flex-row">
            {/* key remounts the stage on a new work so page/zoom reset */}
            <IllustStage key={illust.id} illust={illust} />
            <aside className="flex min-h-0 flex-1 flex-col bg-popover md:h-full md:w-[360px] md:flex-none">
                <ScrollArea className="min-h-0 flex-1">
                    <IllustInfo illust={illust} />
                </ScrollArea>
                {/* Stats + actions pinned to the bottom, always reachable. key resets
                    per-illust local UI state (download "sent"/error, bookmark error/popover)
                    when the viewer switches to another work; bookmark count/state itself is
                    cache-derived, so a same-id detail refetch updates it via props. */}
                <IllustEngagementFooter key={illust.id} illust={illust} />
            </aside>
        </div>
    );
}

function ViewerSkeleton() {
    const m = useMessages();
    return (
        <div className="flex h-full flex-col overflow-hidden md:flex-row">
            <DialogTitle className="sr-only">{m.common_loading()}</DialogTitle>
            <div className="h-[45vh] shrink-0 bg-muted md:h-full md:min-w-0 md:flex-1" />
            <aside className="flex min-h-0 flex-1 flex-col gap-4 bg-popover p-5 md:h-full md:w-[360px] md:flex-none">
                <Skeleton className="h-5 w-2/3" />
                <div className="flex items-center gap-2.5">
                    <Skeleton className="size-10 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-24" />
                        <Skeleton className="h-3 w-16" />
                    </div>
                </div>
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-16 w-full" />
                <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                        <Skeleton key={i} className="h-6 w-14 rounded-full" />
                    ))}
                </div>
            </aside>
        </div>
    );
}

function ViewerError({ illustId }: { illustId: number }) {
    const m = useMessages();
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-popover p-8 text-center">
            <DialogTitle className="sr-only">{m.illust_load_error()}</DialogTitle>
            <div className="text-muted-foreground text-sm">{m.illust_load_error()}</div>
            <a
                href={`https://www.pixiv.net/artworks/${illustId}`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "sm" })}
            >
                <HugeiconsIcon icon={ExternalLinkIcon} strokeWidth={1.8} />
                {m.illust_open_on_pixiv()}
            </a>
        </div>
    );
}

function ViewerBody({ illustId, seed }: { illustId: number; seed: Illust | null }) {
    // Seeded from the clicked card -> instant render; a cold deep-link has no seed
    // and fetches /illusts/{id}.
    const query = useQuery(illustDetailQueryOptions(illustId, seed));
    const illust = query.data?.illust ?? seed ?? null;
    if (illust) return <ViewerContent illust={illust} />;
    if (query.isPending) return <ViewerSkeleton />;
    return <ViewerError illustId={illustId} />;
}

type Shown = { id: number; seed: Illust | null };

function IllustViewerDialog({
    illustId,
    seed,
    onClose,
}: {
    illustId: number | null;
    seed: Illust | null;
    onClose: () => void;
}) {
    const open = illustId != null;

    // Retain the last opened work so the content stays painted through the close
    // animation (illustId/URL clears immediately on close). Adjust-state-during-render
    // keeps `shown` in the same paint as `open`, avoiding an empty first frame.
    // `seed` is already validated against illustId by the provider, so adopt it directly.
    // Re-sync not only when the id changes but also when a seed arrives for an id we
    // retained without one (cold deep-link ?illust=123 → close → click card 123 in a
    // grid): otherwise ViewerBody keeps the stale null seed and loses the instant path.
    const [shown, setShown] = useState<Shown | null>(null);
    if (illustId != null && (shown?.id !== illustId || (seed != null && seed !== shown?.seed))) {
        setShown({ id: illustId, seed });
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                if (!o) onClose();
            }}
            onOpenChangeComplete={(isOpen) => {
                // `shown` is retained through the close ANIMATION (so content stays
                // painted as it fades out); once that animation completes, drop it so
                // ViewerBody/IllustStage fully unmount — releasing the seed reference,
                // tearing down the document keydown listener, and guaranteeing a later
                // open of the same artwork starts fresh (page 1, unzoomed) instead of
                // reusing hidden stage state.
                if (!isOpen) setShown(null);
            }}
        >
            <DialogContent
                showCloseButton={false}
                className="block h-[85vh] w-[calc(100%-2rem)] max-w-6xl gap-0 overflow-hidden p-0 sm:max-w-6xl"
            >
                <DialogClose
                    render={
                        <button
                            type="button"
                            aria-label="Close"
                            className="absolute top-3 right-3 z-30 flex size-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
                        />
                    }
                >
                    <HugeiconsIcon icon={CloseIcon} size={16} strokeWidth={2} />
                </DialogClose>
                {shown && <ViewerBody illustId={shown.id} seed={shown.seed} />}
            </DialogContent>
        </Dialog>
    );
}

export default IllustViewerDialog;
