import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import Avatar from "@/components/avatar";
import PximgImage from "@/components/pximg-image";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterPanel } from "@/features/activity-bar";
import { useAuth } from "@/features/auth";
import { useIllustSelection } from "@/features/downloads";
import { FilteredEmpty, useFilteredIllusts } from "@/features/filter";
import type { Illust } from "@/features/search/api";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
import SearchPager from "@/features/search/components/search-pager";
import { SearchError } from "@/features/search/components/search-states";
import UserList, { UserListSkeleton } from "@/features/search/components/user-list";
import {
    type IllustPage,
    USER_PAGE_SIZE,
    type UserApiError,
    type UserDetailPage,
    type UserIllustsPage,
    type UserPreviewPage,
    userBookmarksQueryOptions,
    userDetailQueryOptions,
    userFollowingQueryOptions,
    userIllustsQueryOptions,
} from "@/features/users/api";
import FollowButton from "@/features/users/components/follow-button";
import UserBookmarksSpecialFilters from "@/features/users/components/user-bookmarks-special-filters";
import { useMessages } from "@/i18n";
import { formatCount, hueFromId } from "@/lib/format";
import { scrollAppToTop } from "@/lib/scroll";
import { patchParams, readPage } from "@/lib/url-params";
import { cn } from "@/lib/utils";
import { isBookmarkTab, isOwnerOnlyTab, isTab, readTab, TAB_ICONS, TABS, type Tab, tabToParam } from "./tabs";

type TabData = UserIllustsPage | IllustPage | UserPreviewPage;

type Messages = ReturnType<typeof useMessages>;

function tabLabel(m: Messages, tab: Tab): string {
    switch (tab) {
        case "illust":
            return m.user_tab_illust();
        case "manga":
            return m.user_tab_manga();
        case "following":
            return m.user_tab_following();
        case "bookmarks":
            return m.user_tab_bookmarks();
        case "bookmarks_private":
            return m.user_tab_bookmarks_private();
    }
}

function ProfileHeader({
    data,
    isMe,
    onSelectTab,
}: {
    data: UserDetailPage;
    isMe: boolean;
    onSelectTab: (tab: Tab) => void;
}) {
    const m = useMessages();
    const { user, profile } = data;
    return (
        <header className="relative overflow-hidden rounded-2xl bg-card p-5 px-6">
            {isMe && <PersonalSeal />}
            <div className="relative flex flex-col gap-4">
                <div className="flex items-start gap-5">
                    <PximgImage
                        src={user.profile_image_urls.medium}
                        alt={user.name}
                        fallback={<Avatar hue={hueFromId(user.id)} initial={user.name[0] ?? "?"} size={84} />}
                        className="size-20 shrink-0 rounded-full object-cover ring-2 ring-white/80"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <h1 className="truncate font-semibold text-2xl text-foreground">{user.name}</h1>
                            {profile.is_premium && (
                                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-[10px] text-amber-600">
                                    Premium
                                </span>
                            )}
                        </div>
                        <div className="font-mono text-muted-foreground text-xs">@{user.account}</div>
                        <p
                            className={cn(
                                "mt-1 whitespace-pre-line text-foreground/85 text-xs leading-relaxed",
                                !user.comment && "text-muted-foreground/30",
                            )}
                        >
                            {user.comment || m.user_profile_no_comment()}
                        </p>
                    </div>
                    {!isMe && <FollowButton key={user.id} userId={user.id} initialIsFollowed={user.is_followed} />}
                </div>

                <div className="flex flex-wrap gap-x-2 gap-y-1.5 border-muted/50 border-t pt-3 text-xs">
                    <Stat
                        label={m.user_stat_illust()}
                        value={profile.total_illusts}
                        onClick={() => onSelectTab("illust")}
                    />
                    <Stat
                        label={m.user_stat_manga()}
                        value={profile.total_manga}
                        onClick={() => onSelectTab("manga")}
                    />
                    <Stat
                        label={m.user_stat_following()}
                        value={profile.total_follow_users}
                        onClick={() => onSelectTab("following")}
                    />
                    <Stat
                        label={m.user_stat_bookmarks()}
                        value={profile.total_illust_bookmarks_public}
                        onClick={() => onSelectTab("bookmarks")}
                    />
                </div>
            </div>
        </header>
    );
}

function PersonalSeal() {
    const m = useMessages();
    return (
        <div aria-hidden className="pointer-events-none absolute top-8 right-4 z-0 rotate-12 select-none">
            <div className="font-semibold text-6xl text-primary/15 tracking-wider">
                {m.user_profile_personal_seal()}
            </div>
        </div>
    );
}

function Stat({ label, value, onClick }: { label: string; value?: number; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="flex cursor-pointer items-baseline gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
        >
            <span className="font-mono font-semibold text-foreground text-sm">{formatCount(value ?? 0)}</span>
            <span className="text-muted-foreground">{label}</span>
        </button>
    );
}

function ProfileHeaderSkeleton() {
    return (
        <header className="flex flex-col gap-4 rounded-2xl bg-card p-6">
            <div className="flex items-start gap-5">
                <Skeleton className="size-20 shrink-0 rounded-full" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-7 w-40" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-1 h-3 w-3/4" />
                </div>
            </div>
            <div className="flex gap-6 border-muted/50 border-t pt-3">
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-5 w-12" />
            </div>
        </header>
    );
}

function NoResults({ tab }: { tab: Tab }) {
    const m = useMessages();
    return (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="font-medium text-foreground text-lg">{m.user_no_content({ tab: tabLabel(m, tab) })}</div>
        </div>
    );
}

function tabHasNext(data: TabData): boolean {
    if ("next_max_bookmark_id" in data && data.next_max_bookmark_id != null) return true;
    return "next_offset" in data && data.next_offset != null;
}

function TabBody({
    tab,
    isPending,
    isError,
    error,
    data,
    selected,
    onToggle,
    filteredIllusts,
    totalBefore,
}: {
    tab: Tab;
    isPending: boolean;
    isError: boolean;
    error: UserApiError | null;
    data: TabData | undefined;
    selected: Set<number>;
    onToggle: (id: number) => void;
    filteredIllusts: Illust[];
    totalBefore: number;
}) {
    if (isPending) {
        return tab === "following" ? <UserListSkeleton /> : <IllustGridSkeleton />;
    }
    if (isError && error) return <SearchError error={error} />;
    if (!data) return null;

    if ("user_previews" in data) {
        return data.user_previews.length === 0 ? <NoResults tab={tab} /> : <UserList previews={data.user_previews} />;
    }
    if (data.illusts.length === 0) return <NoResults tab={tab} />;
    if (filteredIllusts.length === 0) return <FilteredEmpty totalBefore={totalBefore} />;
    return <IllustGrid illusts={filteredIllusts} selected={selected} onToggle={onToggle} />;
}

function UserPage() {
    const m = useMessages();
    const { id: rawId } = useParams<{ id: string }>();
    const userId = Number(rawId);
    const validId = Number.isFinite(userId) && userId > 0;

    const { status: authStatus } = useAuth();
    const authResolved = authStatus !== null;
    const isMe = !!authStatus?.authenticated && authStatus.user_id === userId;

    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = readTab(searchParams);
    const tab: Tab = isOwnerOnlyTab(rawTab) && !isMe ? "bookmarks" : rawTab;
    const page = readPage(searchParams);
    const bookmarkTag = searchParams.get("tag")?.trim() || "";

    const visibleTabs = TABS.filter((t) => !isOwnerOnlyTab(t) || isMe);

    const { selected, toggle, replaceSelection, clearSelection } = useIllustSelection();

    // Pixiv paginates bookmarks by cursor (max_bookmark_id), built up by paging forward
    // from page 1. Public/private bookmark chains are independent — keep one map per
    // restrict. The chain is also tag-specific (Pixiv returns different cursors per tag),
    // so reset when the tag changes. Numbered pages over a forward-only cursor need this
    // page→cursor map (a cursor can only be walked, never computed); TanStack caches the
    // page results, but the chain itself still lives here.
    // useRef, not useMemo: React may discard memoized values, silently losing the chain.
    const cursorsRef = useRef<{
        userId: number;
        tag: string;
        bookmarks: Map<number, number | undefined>;
        bookmarksPrivate: Map<number, number | undefined>;
    } | null>(null);
    if (!cursorsRef.current || cursorsRef.current.userId !== userId || cursorsRef.current.tag !== bookmarkTag) {
        cursorsRef.current = {
            userId,
            tag: bookmarkTag,
            bookmarks: new Map([[1, undefined]]),
            bookmarksPrivate: new Map([[1, undefined]]),
        };
    }
    const cursors = tab === "bookmarks_private" ? cursorsRef.current.bookmarksPrivate : cursorsRef.current.bookmarks;

    const offset = (page - 1) * USER_PAGE_SIZE;
    // No placeholderData: a profile has no pages, so the only time it would kick in is a
    // user-id change — and keeping the previous user's header/follow button on screen under
    // the new id is exactly what we must avoid. Show the skeleton instead.
    const profileQuery = useQuery({
        ...userDetailQueryOptions(userId),
        enabled: validId,
    });
    // Offset tabs keep their numbered pagers; the factories bake in keepPreviousPage, so a
    // same-list page jump keeps the prior page (no skeleton flash) but a user/tab change does
    // not — the old user's or tab's list never lingers as "success" under the new identity.
    const userIllustsQuery = useQuery({
        ...userIllustsQueryOptions({ userId, type: tab === "manga" ? "manga" : "illust", offset }),
        enabled: validId && (tab === "illust" || tab === "manga"),
    });
    const followingQuery = useQuery({
        ...userFollowingQueryOptions({ userId, offset }),
        enabled: validId && tab === "following",
    });
    // Bookmark tabs keep the numbered, forward-only pager: the current page's cursor comes
    // from the chain map, and `enabled` waits until that cursor is known (and, for the
    // owner-only private tab, until auth resolves so we don't fetch public first).
    const bookmarkCursor = cursors.get(page);
    const bookmarksQuery = useQuery({
        ...userBookmarksQueryOptions({
            userId,
            restrict: tab === "bookmarks_private" ? "private" : "public",
            tag: bookmarkTag || undefined,
            maxBookmarkId: bookmarkCursor,
        }),
        enabled:
            validId &&
            isBookmarkTab(tab) &&
            cursors.has(page) &&
            (rawTab === "bookmarks_private" ? authResolved : true),
    });

    const list = isBookmarkTab(tab) ? bookmarksQuery : tab === "following" ? followingQuery : userIllustsQuery;
    const rawTabIllusts = list.data && "illusts" in list.data ? list.data.illusts : undefined;
    const { filtered, totalBefore, totalAfter } = useFilteredIllusts(rawTabIllusts);
    const currentIllustIds = useMemo(() => filtered.map((il) => il.id), [filtered]);

    const specialFilters = useMemo(() => {
        if (tab === "bookmarks" || tab === "bookmarks_private") {
            return (
                <UserBookmarksSpecialFilters
                    tag={bookmarkTag}
                    onTagChange={(v) => setSearchParams((sp) => patchParams(sp, { tag: v || undefined }, true))}
                />
            );
        }
        return null;
    }, [tab, bookmarkTag, setSearchParams]);

    const specialFiltersActiveCount =
        (tab === "bookmarks" || tab === "bookmarks_private") && bookmarkTag !== "" ? 1 : 0;

    const resetSpecialFilters = useCallback(() => {
        setSearchParams((sp) => patchParams(sp, { tag: undefined }, true));
    }, [setSearchParams]);

    useFilterPanel(
        tab === "following"
            ? null
            : {
                  specialFilters,
                  specialFiltersActiveCount,
                  onResetSpecialFilters: resetSpecialFilters,
                  totalBefore,
                  totalAfter,
                  quickAction: {
                      selected,
                      allIllustIds: currentIllustIds,
                      onReplaceSelection: replaceSelection,
                      onClearSelection: clearSelection,
                  },
              },
    );

    // Direct navigation to a deep bookmark page has no cached cursor; fall back to page 1
    // (an undefined cursor would be treated as page 1 and poison the chain). Wait for auth
    // before deciding for the owner-only private tab.
    useEffect(() => {
        if (!validId) return;
        if (rawTab === "bookmarks_private" && !authResolved) return;
        if (isBookmarkTab(tab) && !cursors.has(page)) {
            setSearchParams((sp) => patchParams(sp, { page: undefined }));
        }
    }, [validId, rawTab, authResolved, tab, cursors, page, setSearchParams]);

    // Record the next page's cursor once a bookmark page resolves (replaces the old fetch
    // success callback) so the pager can advance to / jump to page+1. Two guards:
    //  - Skip placeholder data: during a page/tag change keepPreviousPage may still surface the
    //    previous page's result, and storing its cursor under page+1 would jump with the wrong cursor.
    //  - Skip when the current page's cursor is unknown (`!cursors.has(page)`): the query is
    //    disabled then, but its key (maxBookmarkId: undefined) collides with page 1's cache, so
    //    `bookmarksQuery.data` can leak cached page-1 data. Recording its cursor under page+1 would
    //    poison the chain before the deep-link fallback below resets the URL to page 1.
    useEffect(() => {
        if (bookmarksQuery.isPlaceholderData || !cursors.has(page)) return;
        const d = bookmarksQuery.data;
        if (isBookmarkTab(tab) && d && "next_max_bookmark_id" in d && d.next_max_bookmark_id != null) {
            cursors.set(page + 1, d.next_max_bookmark_id);
        }
    }, [bookmarksQuery.data, bookmarksQuery.isPlaceholderData, tab, page, cursors]);

    // Reset selection whenever the list identity (user/tab/page/tag) changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on navigation, not on body deps.
    useEffect(() => {
        clearSelection();
    }, [userId, tab, page, bookmarkTag, clearSelection]);

    const updateParams = (patch: Record<string, string | undefined>, resetPage = false) => {
        setSearchParams(patchParams(searchParams, patch, resetPage));
    };

    const selectTab = (t: Tab) => updateParams({ tab: tabToParam(t) }, true);

    const onTabChange = (v: string) => {
        if (isTab(v)) selectTab(v);
    };

    const onJumpPage = (p: number) => {
        if (isBookmarkTab(tab) && !cursors.has(p)) return;
        updateParams({ page: p === 1 ? undefined : String(p) });
        scrollAppToTop();
    };

    if (!validId) {
        return (
            <div className="px-7 pt-7 pb-7">
                <SearchError error={{ code: "bad_request", kind: "app", message: m.user_invalid_id() }} />
            </div>
        );
    }

    const hasNext = list.data != null && tabHasNext(list.data);

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-7 pb-7">
            {profileQuery.isPending && <ProfileHeaderSkeleton />}
            {profileQuery.isError && <SearchError error={profileQuery.error} />}
            {profileQuery.isSuccess && <ProfileHeader data={profileQuery.data} isMe={isMe} onSelectTab={selectTab} />}

            <Tabs value={tab} onValueChange={onTabChange}>
                <div className="border-muted/60 border-b">
                    <TabsList variant="line" className="h-12 gap-1">
                        {visibleTabs.map((t) => (
                            <TabsTrigger
                                key={t}
                                value={t}
                                className="flex h-full items-center gap-1.5 px-2.5 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                            >
                                <HugeiconsIcon icon={TAB_ICONS[t]} size={16} strokeWidth={2} />
                                {tabLabel(m, t)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
            </Tabs>

            <TabBody
                tab={tab}
                isPending={list.isPending}
                isError={list.isError}
                error={list.error}
                data={list.data}
                selected={selected}
                onToggle={toggle}
                filteredIllusts={filtered}
                totalBefore={totalBefore}
            />

            {list.isSuccess && <SearchPager currentPage={page} hasNext={hasNext} onJump={onJumpPage} />}
        </div>
    );
}

export default UserPage;
