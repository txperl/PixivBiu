import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
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
import { useMessages } from "@/i18n";
import { ExternalLinkIcon } from "@/lib/icons";

// Core notes are Markdown; electron-updater's GitHub feed supplies HTML.
// Parse raw HTML before sanitizing it, then render through the same components.
// The project ships no @tailwindcss/typography plugin, so each element is mapped
// here to a compact, muted scale.
//
// Two heading tiers: when an update spans several versions the backend stitches
// each release under a "## <tag>" version heading (h1/h2), with the changelog's
// own "### Features"/"### Bug fixes" group labels nested below (h3/h4). The
// version heading is bolder and divider-separated so each version reads as its
// own block; a single-version update has no version heading, only group labels.
const VersionHeading = ({ children }: { children?: ReactNode }) => (
    <p className="mt-5 mb-2 border-border/60 border-t pt-4 font-semibold text-foreground text-sm first:mt-0 first:border-t-0 first:pt-0">
        {children}
    </p>
);

const GroupHeading = ({ children }: { children?: ReactNode }) => (
    <p className="mt-3 mb-1.5 font-semibold text-foreground text-xs uppercase tracking-wide first:mt-0">{children}</p>
);

// Hoisted so the plugin list keeps a stable identity across renders.
const releaseNotesPlugins = [remarkGfm];
const releaseNotesHtmlPlugins = [rehypeRaw, rehypeSanitize];

const releaseNotesComponents: Components = {
    h1: VersionHeading,
    h2: VersionHeading,
    h3: GroupHeading,
    h4: GroupHeading,
    p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
    ul: ({ children }) => <ul className="my-1 list-disc space-y-1 pl-4">{children}</ul>,
    ol: ({ children }) => <ol className="my-1 list-decimal space-y-1 pl-4">{children}</ol>,
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {children}
        </a>
    ),
    code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    blockquote: ({ children }) => <blockquote className="my-2 border-border border-l-2 pl-3">{children}</blockquote>,
    table: ({ children }) => (
        <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
        </div>
    ),
    th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
    td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
    hr: () => <hr className="my-2 border-border/60" />,
};

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
            <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
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
                        <Markdown
                            remarkPlugins={releaseNotesPlugins}
                            rehypePlugins={releaseNotesHtmlPlugins}
                            components={releaseNotesComponents}
                        >
                            {notes}
                        </Markdown>
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
