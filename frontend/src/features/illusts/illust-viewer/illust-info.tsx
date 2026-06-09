import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import Avatar from "@/components/avatar";
import PximgImage from "@/components/pximg-image";
import { DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Illust } from "@/features/illusts/api";
import { useIllustBookmark } from "@/features/illusts/use-illust-bookmark";
import FollowButton from "@/features/users/components/follow-button";
import UserLink from "@/features/users/components/user-link";
import { useLocale, useMessages } from "@/i18n";
import { formatCount, formatDate, hueFromId } from "@/lib/format";
import { AiIcon, CheckIcon, CommentIcon, CopyIcon, HeartIcon, ViewsIcon } from "@/lib/icons";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import IllustActionBar from "./illust-action-bar";
import { SafeCaption } from "./safe-caption";

type Messages = ReturnType<typeof useMessages>;

function Badge({ className, children }: { className?: string; children: ReactNode }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide",
                className,
            )}
        >
            {children}
        </span>
    );
}

function Badges({ illust }: { illust: Illust }) {
    const m = useMessages();
    const isAi = illust.illust_ai_type === 2;
    const r18 = illust.x_restrict === 1 ? "r18" : illust.x_restrict >= 2 ? "r18g" : null;
    const isUgoira = illust.type === "ugoira";
    if (!isAi && !r18 && !isUgoira) return null;
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {isUgoira && (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Badge className="cursor-default bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                {m.illust_type_ugoira()}
                            </Badge>
                        }
                    />
                    <TooltipContent>{m.illust_ugoira_static_notice()}</TooltipContent>
                </Tooltip>
            )}
            {isAi && (
                <Badge className="bg-violet-500/15 text-violet-600 dark:text-violet-400">
                    <HugeiconsIcon icon={AiIcon} size={11} strokeWidth={2} />
                    {m.illust_badge_ai()}
                </Badge>
            )}
            {r18 && (
                <Badge className="bg-destructive/12 text-destructive">
                    {r18 === "r18g" ? m.illust_badge_r18g() : m.illust_badge_r18()}
                </Badge>
            )}
        </div>
    );
}

function Stat({ icon, value, label }: { icon: typeof HeartIcon; value: number; label: string }) {
    return (
        <span className="inline-flex items-center gap-1 text-muted-foreground" title={label}>
            <HugeiconsIcon icon={icon} size={13} strokeWidth={1.8} />
            <span className="font-mono text-foreground text-xs">{formatCount(value)}</span>
        </span>
    );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-foreground">{children}</dd>
        </>
    );
}

function CopyableId({ id }: { id: number }) {
    const m = useMessages();
    const { copied, copy } = useCopyToClipboard();
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        onClick={() => copy(String(id))}
                        className="inline-flex cursor-pointer items-center gap-1 rounded font-mono text-foreground transition-colors hover:text-primary"
                    >
                        {id}
                        <HugeiconsIcon icon={copied ? CheckIcon : CopyIcon} size={12} strokeWidth={2} />
                    </button>
                }
            />
            <TooltipContent>{copied ? m.common_copied() : m.common_copy()}</TooltipContent>
        </Tooltip>
    );
}

function typeLabel(m: Messages, type: string): string {
    if (type === "manga") return m.illust_type_manga();
    if (type === "ugoira") return m.illust_type_ugoira();
    return m.illust_type_illust();
}

function IllustInfo({ illust }: { illust: Illust }) {
    const m = useMessages();
    const { locale } = useLocale();
    const navigate = useNavigate();
    const { user } = illust;

    // Navigating to a tag search or author profile changes the route, which drops
    // the ?illust= param and closes the viewer automatically (no explicit close needed).
    const openTag = (name: string) => navigate(`/search/${encodeURIComponent(name)}`);

    return (
        <div className="flex flex-col gap-5 p-5">
            {/* Title + badges (pr to clear the floating close button) */}
            <div className="flex flex-col gap-2 pr-8">
                <Badges illust={illust} />
                <DialogTitle className="font-heading font-semibold text-foreground text-lg leading-snug">
                    {illust.title}
                </DialogTitle>
            </div>

            {/* Author */}
            <div className="flex items-center gap-2.5">
                <UserLink userId={user.id} className="flex min-w-0 flex-1 items-center gap-2.5">
                    <PximgImage
                        src={user.profile_image_urls.medium}
                        alt={user.name}
                        fallback={<Avatar hue={hueFromId(user.id)} initial={user.name[0] ?? "?"} size={40} />}
                        className="size-10 shrink-0 rounded-full"
                    />
                    <div className="min-w-0">
                        <div className="truncate font-medium text-foreground text-sm hover:underline">{user.name}</div>
                        <div className="truncate font-mono text-muted-foreground text-xs">@{user.account}</div>
                    </div>
                </UserLink>
                <FollowButton key={user.id} userId={user.id} initialIsFollowed={user.is_followed} />
            </div>

            {/* Caption */}
            {illust.caption && (
                <SafeCaption html={illust.caption} className="text-foreground/85 text-sm leading-relaxed" />
            )}

            {/* Tags */}
            {illust.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {illust.tags.map((tag) => (
                        <button
                            key={tag.name}
                            type="button"
                            onClick={() => openTag(tag.name)}
                            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                        >
                            <span className="text-primary/70">#</span>
                            <span className="truncate">{tag.name}</span>
                            {tag.translated_name && (
                                <span className="truncate text-muted-foreground/70">{tag.translated_name}</span>
                            )}
                        </button>
                    ))}
                </div>
            )}

            {/* Meta */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-border/60 border-t pt-4 text-xs">
                <MetaRow label={m.illust_meta_size()}>
                    <span className="font-mono">
                        {illust.width} × {illust.height}
                    </span>
                </MetaRow>
                <MetaRow label={m.illust_meta_created()}>{formatDate(illust.create_date, locale)}</MetaRow>
                {illust.page_count > 1 && (
                    <MetaRow label={m.illust_meta_pages()}>
                        <span className="font-mono">{illust.page_count}</span>
                    </MetaRow>
                )}
                <MetaRow label={m.illust_meta_type()}>{typeLabel(m, illust.type)}</MetaRow>
                {/* Pixiv sends `{}` (id 0, empty title), not null, for works with no
                    series — gate on the title we'd actually render, not object presence. */}
                {illust.series?.title && <MetaRow label={m.illust_meta_series()}>{illust.series.title}</MetaRow>}
                {illust.tools.length > 0 && <MetaRow label={m.illust_meta_tools()}>{illust.tools.join(", ")}</MetaRow>}
                <MetaRow label={m.illust_meta_id()}>
                    <CopyableId id={illust.id} />
                </MetaRow>
            </dl>
        </div>
    );
}

// Pinned to the bottom of the info pane (outside the scroll area): read-only stats
// on the left, the icon action group on the right. Stays visible so bookmark/download
// are always reachable; kept small and subtle so the scrollable content leads.
export function IllustEngagementFooter({ illust }: { illust: Illust }) {
    const m = useMessages();
    // Owned here so the bookmark Stat and the toggle cell share one optimistic
    // source — toggling updates the visible count immediately.
    const bookmark = useIllustBookmark({
        illustId: illust.id,
        isBookmarked: illust.is_bookmarked,
        bookmarkCount: illust.total_bookmarks,
    });
    return (
        <div className="flex shrink-0 items-center justify-between gap-3 border-border/60 border-t bg-popover px-5 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <Stat icon={ViewsIcon} value={illust.total_view} label={m.illust_stat_views()} />
                <Stat icon={HeartIcon} value={bookmark.count} label={m.illust_stat_bookmarks()} />
                {illust.total_comments != null && (
                    <Stat icon={CommentIcon} value={illust.total_comments} label={m.illust_stat_comments()} />
                )}
            </div>
            <IllustActionBar illust={illust} bookmark={bookmark} />
        </div>
    );
}

export default IllustInfo;
