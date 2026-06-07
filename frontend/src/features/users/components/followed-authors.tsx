import { useInfiniteQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import Avatar from "@/components/avatar";
import PximgImage from "@/components/pximg-image";
import { Sheet, SheetBody, SheetEmpty, SheetHead } from "@/components/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { followingInfiniteQueryOptions, type Illust } from "@/features/illusts/api";
import IllustPlaceholderArt from "@/features/search/components/illust-placeholder-art";
import UserLink from "@/features/users/components/user-link";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api/error-message";
import type { components } from "@/lib/api/schema.gen";
import { hueFromId } from "@/lib/format";
import { FollowIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type User = components["schemas"]["User"];

const THUMB_LIMIT = 3;

type AuthorGroup = { user: User; illusts: Illust[] };

function groupByAuthor(illusts: Illust[]): AuthorGroup[] {
    const groups = new Map<number, AuthorGroup>();
    for (const il of illusts) {
        const g = groups.get(il.user.id);
        if (g) g.illusts.push(il);
        else groups.set(il.user.id, { user: il.user, illusts: [il] });
    }
    return Array.from(groups.values());
}

function formatRelative(dateStr: string): string {
    const d = new Date(dateStr);
    if (!Number.isFinite(d.getTime())) return "";
    return formatDistanceToNow(d, { addSuffix: true, locale: zhCN });
}

type FollowedAuthorsProps = {
    onView: () => void;
};

function FollowedAuthors({ onView }: FollowedAuthorsProps) {
    const m = useMessages();
    const resolveApiError = useApiErrorMessage();

    // Reuse the home Follow tab's infinite query (same `/illusts/following` feed, shared
    // cache key) and read only the first page — this panel is a glance at the authors in
    // page 1, grouped client-side. Sharing the cache means the feed is fetched once per
    // home visit (TanStack staleTime/gcTime), so returning to home no longer re-pulls, and
    // opening the Follow tab hits the cache this panel seeded.
    const query = useInfiniteQuery(followingInfiniteQueryOptions({ restrict: "public" }));
    const illusts = query.data?.pages[0]?.illusts ?? [];
    const authors: AuthorGroup[] = groupByAuthor(illusts);

    return (
        <Sheet>
            <SheetHead
                icon={FollowIcon}
                title={m.user_followed_authors_title()}
                actions={
                    <Button variant="ghost" size="sm" onClick={onView}>
                        {m.common_view()}
                    </Button>
                }
            />
            <SheetBody>
                {query.isPending ? (
                    <LoadingRows />
                ) : query.isError && authors.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-[18px] text-center text-muted-foreground text-sm">
                        {resolveApiError(query.error)}
                    </div>
                ) : authors.length > 0 ? (
                    <ScrollArea className="h-full">
                        {authors.map((group, i) => (
                            <AuthorRow key={group.user.id} group={group} isFirst={i === 0} />
                        ))}
                    </ScrollArea>
                ) : (
                    <SheetEmpty
                        icon={FollowIcon}
                        title={m.user_followed_authors_empty()}
                        hint={m.user_followed_authors_empty_hint()}
                    />
                )}
            </SheetBody>
        </Sheet>
    );
}

function AuthorRow({ group, isFirst }: { group: AuthorGroup; isFirst: boolean }) {
    const { user, illusts } = group;
    const thumbs = illusts.slice(0, THUMB_LIMIT);
    const count = illusts.length;
    const latestCreate = illusts[0]?.create_date;

    return (
        <UserLink
            userId={user.id}
            className={cn(
                "flex items-center gap-3 px-[18px] py-2.5 transition-colors hover:bg-muted/40",
                !isFirst && "border-muted/40 border-t",
            )}
        >
            <PximgImage
                src={user.profile_image_urls.medium}
                alt={user.name}
                fallback={<Avatar hue={hueFromId(user.id)} initial={user.name[0] ?? "?"} size={32} />}
                className="size-8 shrink-0 rounded-full object-cover ring-2 ring-white/80"
            />
            <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground text-sm">{user.name}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">@{user.account}</div>
            </div>
            <div className="flex gap-[3px]">
                {Array.from({ length: THUMB_LIMIT }).map((_, slot) => {
                    const il = thumbs[slot];
                    const key = il ? `il-${il.id}` : `empty-${user.id}-${slot}`;
                    return il ? (
                        <PximgImage
                            key={key}
                            src={il.image_urls.square_medium}
                            alt={il.title}
                            fallback={
                                <IllustPlaceholderArt
                                    hue={hueFromId(il.id)}
                                    ratio="1/1"
                                    rounded={6}
                                    className="size-[22px]"
                                />
                            }
                            className="size-[22px] rounded-md object-cover"
                        />
                    ) : (
                        <div key={key} className="size-[22px] rounded-md bg-muted/60" />
                    );
                })}
            </div>
            <div className="flex flex-col items-end gap-1">
                <Badge className="font-mono">+{count}</Badge>
                {latestCreate && (
                    <span className="font-mono text-[10px] text-muted-foreground">{formatRelative(latestCreate)}</span>
                )}
            </div>
        </UserLink>
    );
}

function LoadingRows() {
    return (
        <div>
            {Array.from({ length: 5 }).map((_, i) => (
                <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                    key={i}
                    className={cn("flex h-[60px] items-center gap-3 px-[18px]", i !== 0 && "border-muted/40 border-t")}
                >
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-2.5 w-16" />
                    </div>
                    <div className="flex gap-[3px]">
                        <Skeleton className="size-[22px]" />
                        <Skeleton className="size-[22px]" />
                        <Skeleton className="size-[22px]" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default FollowedAuthors;
