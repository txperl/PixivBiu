import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// Core and desktop notes are Markdown (desktop embeds its changelog in
// latest*.yml); desktop releases published before that fell back to the GitHub
// feed's HTML. Parse raw HTML before sanitizing it, then render through the
// same components.
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

// Loaded on demand by ReleaseNotesDialog: the Markdown/HTML pipeline is a
// large share of the bundle and only this dialog uses it.
export default function ReleaseNotesMarkdown({ notes }: { notes: string }) {
    return (
        <Markdown
            remarkPlugins={releaseNotesPlugins}
            rehypePlugins={releaseNotesHtmlPlugins}
            components={releaseNotesComponents}
        >
            {notes}
        </Markdown>
    );
}
