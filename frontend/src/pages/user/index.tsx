import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import Avatar from "@/components/avatar";
import PximgImage from "@/components/pximg-image";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { isTab, readTab, TAB_LABELS, TABS, type Tab } from "./tabs";

type TabData = UserIllustsPage | IllustPage | UserPreviewPage;

function ProfileHeader({ data }: { data: UserDetailPage }) {
    const { user, profile } = data;
    return (
        <header className="flex flex-col gap-4 rounded-2xl bg-card p-6">
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
                    {user.comment && (
                        <p className="mt-2 whitespace-pre-line text-foreground/85 text-sm leading-relaxed">
                            {user.comment}
                        </p>
                    )}
                </div>
                <FollowButton key={user.id} userId={user.id} initialIsFollowed={user.is_followed} />
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-1.5 border-muted/50 border-t pt-3 text-xs">
                <Stat label="插画" value={profile.total_illusts} />
                <Stat label="漫画" value={profile.total_manga} />
                <Stat label="收藏" value={profile.total_illust_bookmarks_public} />
                <Stat label="关注" value={profile.total_follow_users} />
            </div>
        </header>
    );
}

function Stat({ label, value }: { label: string; value?: number }) {
    return (
        <div className="flex items-baseline gap-1.5">
            <span className="font-mono font-semibold text-foreground text-sm">{formatCount(value ?? 0)}</span>
            <span className="text-muted-foreground">{label}</span>
        </div>
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
                    <Skeleton className="mt-2 h-4 w-3/4" />
                </div>
            </div>
            <div className="flex gap-6 border-muted/50 border-t pt-3">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-12" />
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
    if (tab === "following") return listUserFollowing({ userId, offset });
    return listUserIllusts({ userId, type: tab as UserIllustsType, offset });
}

function tabHasNext(data: TabData): boolean {
    if ("next_max_bookmark_id" in data && data.next_max_bookmark_id != null) return true;
    return "next_offset" in data && data.next_offset != null;
}

function TabBody({ tab, state }: { tab: Tab; state: FetchState<TabData> }) {
    if (state.status === "loading") {
        return tab === "following" ? <UserListSkeleton /> : <IllustGridSkeleton />;
    }
    if (state.status === "error") return <SearchError error={state.error} />;
    if (state.status !== "success") return null;

    const data = state.data;
    if ("user_previews" in data) {
        return data.user_previews.length === 0 ? <NoResults tab={tab} /> : <UserList previews={data.user_previews} />;
    }
    return data.illusts.length === 0 ? <NoResults tab={tab} /> : <IllustGrid illusts={data.illusts} />;
}

function UserPage() {
    const { id: rawId } = useParams<{ id: string }>();
    const userId = Number(rawId);
    const validId = Number.isFinite(userId) && userId > 0;

    const [searchParams, setSearchParams] = useSearchParams();
    const tab = readTab(searchParams);
    const page = readPage(searchParams);

    const [profileState, setProfileState] = useState<FetchState<UserDetailPage>>({ status: "idle" });
    const [tabState, setTabState] = useState<FetchState<TabData>>({ status: "idle" });

    // Bookmarks paginate by cursor (max_bookmark_id), not offset. cursors maps
    // page → max_bookmark_id; jumping to an unseen forward page is gated in onJumpPage.
    // Tagged with userId so it resets on user change. We use a ref (not useMemo) because
    // React reserves the right to discard memoized values, which would silently lose the
    // cursor chain mid-pagination.
    const cursorsRef = useRef<{ userId: number; map: Map<number, number | undefined> } | null>(null);
    if (!cursorsRef.current || cursorsRef.current.userId !== userId) {
        cursorsRef.current = { userId, map: new Map([[1, undefined]]) };
    }
    const cursors = cursorsRef.current.map;

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
        // Bookmark cursor for this page must already be cached (built up by paging
        // forward from page 1). On direct navigation to a deep page (refresh, shared
        // link), the cursor is unknown — fall back to page 1 instead of fetching with
        // an undefined cursor, which Pixiv would silently treat as page 1 and corrupt
        // the page→cursor cache for the rest of the session.
        if (tab === "bookmarks" && !cursors.has(page)) {
            setSearchParams((sp) => patchParams(sp, { page: undefined }));
            return;
        }
        let cancelled = false;
        setTabState({ status: "loading" });
        const cursor = tab === "bookmarks" ? cursors.get(page) : undefined;
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
    }, [userId, validId, tab, page, cursors, setSearchParams]);

    const updateParams = (patch: Record<string, string | undefined>, resetPage = false) => {
        setSearchParams(patchParams(searchParams, patch, resetPage));
    };

    const onTabChange = (v: string) => {
        if (!isTab(v)) return;
        updateParams({ tab: v === "illust" ? undefined : v }, true);
    };

    const onJumpPage = (p: number) => {
        if (tab === "bookmarks" && !cursors.has(p)) return;
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
            {profileState.status === "success" && <ProfileHeader data={profileState.data} />}

            <Tabs value={tab} onValueChange={onTabChange}>
                <div className="border-muted/60 border-b">
                    <TabsList variant="line" className="h-12 gap-0">
                        {TABS.map((t) => (
                            <TabsTrigger
                                key={t}
                                value={t}
                                className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                            >
                                {TAB_LABELS[t]}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
            </Tabs>

            <TabBody tab={tab} state={tabState} />

            {tabState.status === "success" && <SearchPager currentPage={page} hasNext={hasNext} onJump={onJumpPage} />}
        </div>
    );
}

export default UserPage;
