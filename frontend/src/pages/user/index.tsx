import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import Avatar from "@/components/avatar";
import PximgImage from "@/components/pximg-image";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/features/auth";
import { useIllustSelection } from "@/features/downloads";
import DownloadFAB from "@/features/downloads/components/download-fab";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
import SearchPager from "@/features/search/components/search-pager";
import { SearchError } from "@/features/search/components/search-states";
import UserList, { UserListSkeleton } from "@/features/search/components/user-list";
import {
    getUser,
    type IllustPage,
    listUserBookmarks,
    listUserFollowing,
    listUserIllusts,
    USER_PAGE_SIZE,
    type UserDetailPage,
    type UserIllustsPage,
    type UserIllustsType,
    type UserPreviewPage,
} from "@/features/users/api";
import FollowButton from "@/features/users/components/follow-button";
import type { FetchState } from "@/lib/fetch-state";
import { formatCount, hueFromId } from "@/lib/format";
import { patchParams, readPage } from "@/lib/url-params";
import { cn } from "@/lib/utils";
import {
    isBookmarkTab,
    isOwnerOnlyTab,
    isTab,
    readTab,
    TAB_ICONS,
    TAB_LABELS,
    TABS,
    type Tab,
    tabToParam,
} from "./tabs";

type TabData = UserIllustsPage | IllustPage | UserPreviewPage;

function ProfileHeader({
    data,
    isMe,
    onSelectTab,
}: {
    data: UserDetailPage;
    isMe: boolean;
    onSelectTab: (tab: Tab) => void;
}) {
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
                            <h1 className="truncate font-semibold text-2xl text-foreground" title={user.name}>
                                {user.name}
                            </h1>
                            {profile.is_premium && (
                                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-[10px] text-amber-600">
                                    Premium
                                </span>
                            )}
                        </div>
                        <div className="font-mono text-muted-foreground text-xs" title={user.account}>
                            @{user.account}
                        </div>
                        <p
                            className={cn(
                                "mt-1 whitespace-pre-line text-foreground/85 text-xs leading-relaxed",
                                !user.comment && "text-muted-foreground/30",
                            )}
                        >
                            {user.comment || "介绍里没有什么哦"}
                        </p>
                    </div>
                    {!isMe && <FollowButton key={user.id} userId={user.id} initialIsFollowed={user.is_followed} />}
                </div>

                <div className="flex flex-wrap gap-x-2 gap-y-1.5 border-muted/50 border-t pt-3 text-xs">
                    <Stat label="插画" value={profile.total_illusts} onClick={() => onSelectTab("illust")} />
                    <Stat label="漫画" value={profile.total_manga} onClick={() => onSelectTab("manga")} />
                    <Stat label="关注" value={profile.total_follow_users} onClick={() => onSelectTab("following")} />
                    <Stat
                        label="收藏"
                        value={profile.total_illust_bookmarks_public}
                        onClick={() => onSelectTab("bookmarks")}
                    />
                </div>
            </div>
        </header>
    );
}

function PersonalSeal() {
    return (
        <div aria-hidden className="pointer-events-none absolute top-8 right-4 z-0 rotate-12 select-none">
            <div className="font-semibold text-6xl text-primary/15 tracking-wider">个人</div>
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
    return (
        <div className="flex flex-col items-center gap-2 py-20 text-center">
            <div className="font-medium text-foreground text-lg">该用户还没有{TAB_LABELS[tab]}内容</div>
        </div>
    );
}

function fetchTabData(tab: Tab, userId: number, page: number, cursor: number | undefined) {
    const offset = (page - 1) * USER_PAGE_SIZE;
    if (tab === "bookmarks") return listUserBookmarks({ userId, maxBookmarkId: cursor });
    if (tab === "bookmarks_private") {
        return listUserBookmarks({ userId, restrict: "private", maxBookmarkId: cursor });
    }
    if (tab === "following") return listUserFollowing({ userId, offset });
    return listUserIllusts({ userId, type: tab as UserIllustsType, offset });
}

function tabHasNext(data: TabData): boolean {
    if ("next_max_bookmark_id" in data && data.next_max_bookmark_id != null) return true;
    return "next_offset" in data && data.next_offset != null;
}

function TabBody({
    tab,
    state,
    selected,
    onToggle,
}: {
    tab: Tab;
    state: FetchState<TabData>;
    selected: Set<number>;
    onToggle: (id: number) => void;
}) {
    if (state.status === "loading") {
        return tab === "following" ? <UserListSkeleton /> : <IllustGridSkeleton />;
    }
    if (state.status === "error") return <SearchError error={state.error} />;
    if (state.status !== "success") return null;

    const data = state.data;
    if ("user_previews" in data) {
        return data.user_previews.length === 0 ? <NoResults tab={tab} /> : <UserList previews={data.user_previews} />;
    }
    return data.illusts.length === 0 ? (
        <NoResults tab={tab} />
    ) : (
        <IllustGrid illusts={data.illusts} selected={selected} onToggle={onToggle} />
    );
}

function UserPage() {
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

    const visibleTabs = TABS.filter((t) => !isOwnerOnlyTab(t) || isMe);

    const [profileState, setProfileState] = useState<FetchState<UserDetailPage>>({ status: "idle" });
    const [tabState, setTabState] = useState<FetchState<TabData>>({ status: "idle" });
    const { selected, toggle, replaceSelection, clearSelection } = useIllustSelection();
    const currentIllustIds =
        tabState.status === "success" && "illusts" in tabState.data ? tabState.data.illusts.map((il) => il.id) : [];

    // Pixiv paginates bookmarks by cursor (max_bookmark_id), built up by paging forward
    // from page 1. Public/private bookmark chains are independent — keep one map per
    // restrict so leaving and returning to a bookmark tab preserves the chain.
    // useRef, not useMemo: React may discard memoized values, silently losing the chain.
    const cursorsRef = useRef<{
        userId: number;
        bookmarks: Map<number, number | undefined>;
        bookmarksPrivate: Map<number, number | undefined>;
    } | null>(null);
    if (!cursorsRef.current || cursorsRef.current.userId !== userId) {
        cursorsRef.current = {
            userId,
            bookmarks: new Map([[1, undefined]]),
            bookmarksPrivate: new Map([[1, undefined]]),
        };
    }
    const cursors = tab === "bookmarks_private" ? cursorsRef.current.bookmarksPrivate : cursorsRef.current.bookmarks;

    useEffect(() => {
        if (!validId) return;
        let cancelled = false;
        setProfileState({ status: "loading" });
        getUser(userId).then(({ data, error }) => {
            if (cancelled) return;
            if (error) setProfileState({ status: "error", error });
            else if (data) setProfileState({ status: "success", data });
        });
        return () => {
            cancelled = true;
        };
    }, [userId, validId]);

    useEffect(() => {
        if (!validId) return;
        // Wait for auth before falling back from bookmarks_private → bookmarks; otherwise
        // an owner refreshing on ?tab=bookmarks_private fetches public first, then private.
        if (rawTab === "bookmarks_private" && !authResolved) return;
        // Direct navigation to a deep bookmark page has no cached cursor; fall back to
        // page 1. Fetching with undefined cursor is treated as page 1 by Pixiv and would
        // poison the page→cursor cache.
        if (isBookmarkTab(tab) && !cursors.has(page)) {
            setSearchParams((sp) => patchParams(sp, { page: undefined }));
            return;
        }
        let cancelled = false;
        setTabState({ status: "loading" });
        clearSelection();
        const cursor = isBookmarkTab(tab) ? cursors.get(page) : undefined;
        fetchTabData(tab, userId, page, cursor).then(({ data, error }) => {
            if (cancelled) return;
            if (error) setTabState({ status: "error", error });
            else if (data) {
                setTabState({ status: "success", data });
                if ("next_max_bookmark_id" in data && data.next_max_bookmark_id != null) {
                    cursors.set(page + 1, data.next_max_bookmark_id);
                }
            }
        });
        return () => {
            cancelled = true;
        };
    }, [userId, validId, tab, rawTab, authResolved, page, cursors, setSearchParams, clearSelection]);

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
        document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
    };

    if (!validId) {
        return (
            <div className="px-7 pt-7 pb-7">
                <SearchError error={{ code: "bad_request", message: "用户 ID 无效" }} />
            </div>
        );
    }

    const hasNext = tabState.status === "success" && tabHasNext(tabState.data);

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-7 pb-7">
            {profileState.status === "loading" && <ProfileHeaderSkeleton />}
            {profileState.status === "error" && <SearchError error={profileState.error} />}
            {profileState.status === "success" && (
                <ProfileHeader data={profileState.data} isMe={isMe} onSelectTab={selectTab} />
            )}

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
                                {TAB_LABELS[t]}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
            </Tabs>

            <TabBody tab={tab} state={tabState} selected={selected} onToggle={toggle} />

            {tabState.status === "success" && <SearchPager currentPage={page} hasNext={hasNext} onJump={onJumpPage} />}

            {tab !== "following" && (
                <DownloadFAB
                    selected={selected}
                    allIllustIds={currentIllustIds}
                    onReplaceSelection={replaceSelection}
                    onClearSelection={clearSelection}
                />
            )}
        </div>
    );
}

export default UserPage;
