import { Fragment, type ReactNode, useMemo } from "react";
import { cn } from "@/lib/utils";

// Pixiv captions are simple HTML — <br>, <a href="…">…</a>, occasionally
// <strong>. There is no sanitizer dependency in the repo and we never use
// dangerouslySetInnerHTML; instead we parse the few tags we trust into real
// React nodes. Safety guarantee: the only HTML we construct is <a>/<br> elements
// we author here; all caption-derived text reaches the DOM as React string
// children (auto-escaped), and link hrefs are validated against an http(s)
// allowlist (so javascript: / data: URLs are dropped).

const A_TAG = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

function stripTags(s: string): string {
    return s.replace(/<[^>]*>/g, "");
}

function decodeEntities(s: string): string {
    return s
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&nbsp;/g, " ");
}

function clean(s: string): string {
    return decodeEntities(stripTags(s));
}

function renderLine(line: string, keyBase: string): ReactNode[] {
    const nodes: ReactNode[] = [];
    let lastIndex = 0;
    for (const match of line.matchAll(A_TAG)) {
        const [full, href, inner] = match;
        const start = match.index ?? 0;
        if (start > lastIndex) nodes.push(clean(line.slice(lastIndex, start)));
        const safeHref = /^https?:\/\//i.test(href) ? href : null;
        const text = clean(inner);
        if (safeHref) {
            // `start` is unique and increasing per line, so it's a stable link key.
            nodes.push(
                <a key={`${keyBase}-a-${start}`} href={safeHref} target="_blank" rel="noopener noreferrer nofollow">
                    {text}
                </a>,
            );
        } else {
            nodes.push(text);
        }
        lastIndex = start + full.length;
    }
    if (lastIndex < line.length) nodes.push(clean(line.slice(lastIndex)));
    return nodes;
}

export function SafeCaption({ html, className }: { html: string; className?: string }) {
    const lines = useMemo(() => html.split(/<br\s*\/?>/i), [html]);
    return (
        <div className={cn("*:[a]:text-primary *:[a]:underline *:[a]:underline-offset-2", className)}>
            {lines.map((line, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: caption lines are a static, ordered split
                <Fragment key={idx}>
                    {idx > 0 && <br />}
                    {renderLine(line, String(idx))}
                </Fragment>
            ))}
        </div>
    );
}
