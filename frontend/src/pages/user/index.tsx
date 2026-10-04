import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import Avatar from "@/components/avatar";
import ListLoadingOverlay from "@/components/list-loading-overlay";
import PageBeyondEnd from "@/components/page-beyond-end";
import Pager from "@/components/pager";
import PximgImage from "@/components/pximg-image";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterPanel } from "@/features/activity-bar";
import { useAuth } from "@/features/auth";
import { useIllustSelection } from "@/features/downloads";
import { FilteredEmpty, useFilteredIllusts } from "@/features/filter";
import type { Illust } from "@/features/search/api";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
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
import { usePageRefresh } from "@/lib/page-refresh";
import { cursorFrontier, type PageObservation, pageOutcome, pagerStateOf } from "@/lib/pagination";
import { resetNumberedList, usePageFrontier, useRecordPage } from "@/lib/query/page-frontier";
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

function tabObservation(page: number, data: TabData): PageObservation {
    const count = "user_previews" in data ? data.user_previews.length : data.illusts.length;
    const nextCursor = "next_max_bookmark_id" in data ? (data.next_max_bookmark_id ?? undefined) : undefined;
    return { page, outcome: pageOutcome(tabHasNext(data), count), nextCursor };
}

// Profile totals give offset tabs an estimated last page. Pixiv counts works the list may not
// return (hidden / deleted), so it's only a hint the pager corrects once the end is seen.
// Bookmarks get none: reaching a far cursor page means walking every page before it.
function tabTotal(tab: Tab, data: UserDetailPage | undefined): number | undefined {
    if (!data) return undefined;
    switch (tab) {
        case "illust":
            return data.profile.total_illusts;
        case "manga":
            return data.profile.total_manga;
        case "following":
            return data.profile.total_follow_users;
        default:
            return undefined;
    }
}

function TabBody({
    tab,
    isPending,
    isError,
    error,
    data,
    selected,
    onToggle,
    selectMode,
    selectionDisabled,
    filteredIllusts,
    totalBefore,
}: {
    tab: Tab;
    isPending: boolean;
    isError: boolean;
    error: UserApiError | null;
    data: TabData | undefined;
    selected: ReadonlySet<number>;
    selectMode: boolean;
    selectionDisabled: boolean;
    onToggle: (id: number, control: HTMLElement) => void;
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
    return (
        <IllustGrid
            illusts={filteredIllusts}
            selected={selected}
            onToggle={onToggle}
            selectMode={selectMode}
            selectionDisabled={selectionDisabled}
        />
    );
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

    const queryClient = useQueryClient();
    const restrict = tab === "bookmarks_private" ? "private" : "public";
    // One frontier per list. A bookmark chain is specific to its restrict and tag (Pixiv
    // returns different cursors for each), so both are part of its identity.
    const frontierIdentity = isBookmarkTab(tab)
        ? ["user-bookmarks", userId, restrict, bookmarkTag]
        : ["user-list", userId, tab];
    const { frontier, record } = usePageFrontier(frontierIdentity);
    // Refresh re-pulls the profile in place and the current tab's list from page 1.
    usePageRefresh(() => {
        const listKey = isBookmarkTab(tab)
            ? ["user-bookmarks", { userId, restrict }]
            : tab === "following"
              ? ["user-following", { userId }]
              : ["user-illusts", { userId, type: tab === "manga" ? "manga" : "illust" }];
        void queryClient.invalidateQueries({ queryKey: userDetailQueryOptions(userId).queryKey });
        void resetNumberedList(queryClient, listKey, frontierIdentity);
    });

    // Pixiv paginates bookmarks by cursor (max_bookmark_id): a page's cursor only comes from
    // the previous page's response, so numbered pages rely on the page→cursor chain the
    // frontier records. The chain covers pages 1..W contiguously. If `page` is past W we fetch
    // W instead — recording its next cursor extends the chain, which re-renders this with W+1
    // — and keep walking until the chain reaches `page`. A pager click and a deep URL are the
    // same event (`?page=N`), so this one mechanism serves both. The walk stops at the real
    // last page (see the clamp effect), so an over-shot page can't loop forever.
    const walkFrom = cursorFrontier(frontier);
    const fetchPage = isBookmarkTab(tab) ? Math.min(page, walkFrom) : page;
    const isWalking = fetchPage !== page;
    const cursorOf = (p: number) => (p === 1 ? undefined : frontier.cursors?.[p]);

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
    // Bookmark tabs keep the numbered, forward-only pager. We fetch `fetchPage` — the
    // requested page when its cursor is known, otherwise the frontier we're walking from —
    // so its cursor is always available. `enabled` only waits, for the owner-only private
    // tab, until auth resolves so we don't fetch public first.
    const bookmarksQuery = useQuery({
        ...userBookmarksQueryOptions({
            userId,
            restrict,
            tag: bookmarkTag || undefined,
            maxBookmarkId: cursorOf(fetchPage),
        }),
        enabled: validId && isBookmarkTab(tab) && (rawTab === "bookmarks_private" ? authResolved : true),
    });

    const list = isBookmarkTab(tab) ? bookmarksQuery : tab === "following" ? followingQuery : userIllustsQuery;
    // While walking, `list.data` is an intermediate hop's page — don't surface it (the grid
    // shows a skeleton; the filter-panel counts shouldn't flicker through it either).
    const rawTabIllusts = !isWalking && list.data && "illusts" in list.data ? list.data.illusts : undefined;
    const { filtered, totalBefore, totalAfter } = useFilteredIllusts(rawTabIllusts);
    const currentIllustIds = useMemo(() => filtered.map((il) => il.id), [filtered]);
    const selection = useIllustSelection({
        identity: JSON.stringify([userId, tab, page, bookmarkTag]),
        visibleIds: currentIllustIds,
        enabled: tab !== "following" && list.isSuccess && !list.isPlaceholderData && !isWalking,
        scope: "page",
    });
    const { selected, toggle } = selection;

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
              },
    );

    // Record what the fetched page says about the list (and, for bookmarks, the next page's
    // cursor). `fetchPage` is the page actually fetched: the frontier while walking, the
    // requested page otherwise. Skip placeholder data: keepPreviousPage surfaces the prior
    // page's result, which must not be recorded under this page.
    const observed = list.data && !list.isPlaceholderData ? tabObservation(fetchPage, list.data) : undefined;
    useRecordPage(record, observed);

    // A walk hop that ends the list before reaching the requested page means the jump / deep
    // link overshot: clamp the URL to the last real page so the walk stops and shows it.
    const walkEnded = isWalking && observed != null && observed.outcome !== "more";
    useEffect(() => {
        if (!walkEnded) return;
        setSearchParams((sp) => patchParams(sp, { page: fetchPage === 1 ? undefined : String(fetchPage) }));
    }, [walkEnded, fetchPage, setSearchParams]);

    const total = tabTotal(tab, profileQuery.data);
    const lastPageHint = total ? Math.ceil(total / USER_PAGE_SIZE) : undefined;
    const pagerState = pagerStateOf(frontier, page, isWalking ? undefined : observed, lastPageHint);
    const beyondEnd = page > 1 && !isWalking && observed?.outcome === "empty";

    const updateParams = (patch: Record<string, string | undefined>, resetPage = false) => {
        setSearchParams(patchParams(searchParams, patch, resetPage));
    };

    const selectTab = (t: Tab) => updateParams({ tab: tabToParam(t) }, true);

    const onTabChange = (v: string) => {
        if (isTab(v)) selectTab(v);
    };

    const onJumpPage = (p: number) => {
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

    // Prefetch on intent. A bookmark page can only be fetched once its cursor is known.
    const onPageIntent = (p: number) => {
        let fetched: Promise<TabData>;
        if (isBookmarkTab(tab)) {
            if (p > walkFrom) return;
            fetched = queryClient.fetchQuery(
                userBookmarksQueryOptions({
                    userId,
                    restrict,
                    tag: bookmarkTag || undefined,
                    maxBookmarkId: cursorOf(p),
                }),
            );
        } else if (tab === "following") {
            fetched = queryClient.fetchQuery(userFollowingQueryOptions({ userId, offset: (p - 1) * USER_PAGE_SIZE }));
        } else {
            fetched = queryClient.fetchQuery(
                userIllustsQueryOptions({
                    userId,
                    type: tab === "manga" ? "manga" : "illust",
                    offset: (p - 1) * USER_PAGE_SIZE,
                }),
            );
        }
        fetched.then((d) => record(tabObservation(p, d))).catch(() => {});
    };

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-7 pb-7">
            {profileQuery.isPending && <ProfileHeaderSkeleton />}
            {profileQuery.isError && <SearchError error={profileQuery.error} />}
            {profileQuery.isSuccess && <ProfileHeader data={profileQuery.data} isMe={isMe} onSelectTab={selectTab} />}

            <Tabs value={tab} onValueChange={onTabChange}>
                <div
                    data-app-controls=""
                    className="flex flex-wrap items-center justify-between gap-2 border-muted/60 border-b"
                >
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

            <ListLoadingOverlay active={list.isPlaceholderData && !isWalking}>
                {beyondEnd ? (
                    <PageBeyondEnd target={pagerState.knownMax} onJump={onJumpPage} />
                ) : (
                    <TabBody
                        tab={tab}
                        isPending={!list.isError && (list.isPending || isWalking)}
                        isError={list.isError}
                        error={list.error}
                        data={list.data}
                        selected={selected}
                        onToggle={toggle}
                        selectMode={selection.mode}
                        selectionDisabled={selection.disabled}
                        filteredIllusts={filtered}
                        totalBefore={totalBefore}
                    />
                )}
            </ListLoadingOverlay>

            {list.isSuccess && !isWalking && <Pager state={pagerState} onJump={onJumpPage} onIntent={onPageIntent} />}
        </div>
    );
}

export default UserPage;
