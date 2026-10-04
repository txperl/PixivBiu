import { HugeiconsIcon } from "@hugeicons/react";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessages } from "@/i18n";
import { ExternalLinkIcon } from "@/lib/icons";

const loadReleaseNotesMarkdown = () => import("./release-notes-markdown");
const ReleaseNotesMarkdown = lazy(loadReleaseNotesMarkdown);

interface ReleaseNotesDialogProps {
    version: string;
    notes: string;
    // Pre-formatted "Released 3 days ago" line, shown under the title.
    releasedLabel?: string;
    releaseUrl?: string;
    applying: boolean;
    onApply: () => void;
}

// The "What's new" preview launched from the update banner. Renders the cleaned
// release notes in a focused modal and offers the same one-click Update & restart
// from its footer, so the user can act straight from the preview.
export function ReleaseNotesDialog({
    version,
    notes,
    releasedLabel,
    releaseUrl,
    applying,
    onApply,
}: ReleaseNotesDialogProps) {
    const m = useMessages();
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {/* Fetch the renderer on intent so it is usually ready when the dialog opens. */}
            <DialogTrigger
                render={<Button type="button" variant="outline" size="sm" />}
                onPointerEnter={() => void loadReleaseNotesMarkdown()}
                onFocus={() => void loadReleaseNotesMarkdown()}
            >
                {m.settings_about_whats_new()}
            </DialogTrigger>

            <DialogContent className="gap-0 p-0 sm:max-w-lg">
                <DialogHeader className="border-b p-3 pt-3.5">
                    <DialogTitle>{m.settings_about_whats_new_title({ version })}</DialogTitle>
                    {releasedLabel && <DialogDescription className="text-xs">{releasedLabel}</DialogDescription>}
                </DialogHeader>

                {/* DialogContent is padded p-0, so the scroll area spans edge-to-edge and
                    its scrollbar sits flush with the dialog border; the text keeps its
                    readable inset via p-3 on the inner content. The height cap lives on the
                    viewport (not the root) so it scrolls reliably in this content-sized dialog. */}
                <ScrollArea viewportProps={{ className: "max-h-[60vh]" }}>
                    <div className="p-3 text-muted-foreground text-sm">
                        <Suspense
                            fallback={
                                <div className="space-y-2 py-1">
                                    <Skeleton className="h-3 w-2/3" />
                                    <Skeleton className="h-3 w-full" />
                                    <Skeleton className="h-3 w-5/6" />
                                </div>
                            }
                        >
                            <ReleaseNotesMarkdown notes={notes} />
                        </Suspense>
                    </div>
                </ScrollArea>

                <DialogFooter className="m-0 p-3">
                    {releaseUrl && (
                        <a
                            href={releaseUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mr-auto inline-flex items-center gap-1 self-center text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
                        >
                            <HugeiconsIcon icon={ExternalLinkIcon} size={12} strokeWidth={2} />
                            {m.settings_about_release_notes_view_github()}
                        </a>
                    )}
                    <Button
                        type="button"
                        size="sm"
                        disabled={applying}
                        onClick={() => {
                            setOpen(false);
                            onApply();
                        }}
                    >
                        {m.settings_about_apply()}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
