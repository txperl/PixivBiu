import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIllustSelection } from "@/features/downloads";
import DownloadFAB from "@/features/downloads/components/download-fab";
import {
    DEFAULT_SEARCH_SORT,
    DEFAULT_SEARCH_TARGET,
    type IllustPage,
    SEARCH_PAGE_SIZE,
    SEARCH_SORTS,
    SEARCH_TARGETS,
    type SearchSort,
    type SearchTarget,
    searchIllusts,
    searchUsers,
    type UserPreviewPage,
} from "@/features/search/api";
import IllustGrid, { IllustGridSkeleton } from "@/features/search/components/illust-grid";
import SearchBar from "@/features/search/components/search-bar";
import SearchFilters from "@/features/search/components/search-filters";
import SearchPager from "@/features/search/components/search-pager";
import { SearchEmptyState, SearchError, SearchNoResults } from "@/features/search/components/search-states";
import UserList, { UserListSkeleton } from "@/features/search/components/user-list";
import type { FetchState } from "@/lib/fetch-state";
import { patchParams, readPage } from "@/lib/url-params";

type SearchType = "illust" | "user";

function readType(sp: URLSearchParams): SearchType {
    return sp.get("type") === "user" ? "user" : "illust";
}

function readTarget(sp: URLSearchParams): SearchTarget {
    const v = sp.get("target");
    return (SEARCH_TARGETS as readonly string[]).includes(v ?? "") ? (v as SearchTarget) : DEFAULT_SEARCH_TARGET;
}

function readSort(sp: URLSearchParams): SearchSort {
    const v = sp.get("sort");
    return (SEARCH_SORTS as readonly string[]).includes(v ?? "") ? (v as SearchSort) : DEFAULT_SEARCH_SORT;
}

function SearchPage() {
    const { keyword: rawKeyword } = useParams<{ keyword?: string }>();
    const [searchParams, setSearchParams] = useSearchParams();

    const keyword = rawKeyword ?? "";
    const type = readType(searchParams);
    const target = readTarget(searchParams);
    const sort = readSort(searchParams);
    const page = readPage(searchParams);

    const [illustState, setIllustState] = useState<FetchState<IllustPage>>({ status: "idle" });
    const [userState, setUserState] = useState<FetchState<UserPreviewPage>>({ status: "idle" });
    const { selected, selectedIllustIds, toggle, clearSelection } = useIllustSelection();

    useEffect(() => {
        clearSelection();
        if (!keyword) {
            setIllustState({ status: "idle" });
            setUserState({ status: "idle" });
            return;
        }
        let cancelled = false;
        const offset = (page - 1) * SEARCH_PAGE_SIZE;
        if (type === "illust") {
            setIllustState({ status: "loading" });
            searchIllusts({ word: keyword, searchTarget: target, sort, offset }).then(({ data, error }) => {
                if (cancelled) return;
                if (error) setIllustState({ status: "error", error });
                else if (data) setIllustState({ status: "success", data });
            });
        } else {
            setUserState({ status: "loading" });
            searchUsers({ word: keyword, offset }).then(({ data, error }) => {
                if (cancelled) return;
                if (error) setUserState({ status: "error", error });
                else if (data) setUserState({ status: "success", data });
            });
        }
        return () => {
            cancelled = true;
        };
    }, [keyword, type, target, sort, page, clearSelection]);

    const updateParams = (patch: Record<string, string | undefined>, resetPage = false) => {
        setSearchParams(patchParams(searchParams, patch, resetPage));
    };

    const onTabChange = (v: string) => {
        if (v !== "illust" && v !== "user") return;
        updateParams({ type: v === "illust" ? undefined : "user" }, true);
    };

    const onJumpPage = (p: number) => {
        updateParams({ page: p === 1 ? undefined : String(p) });
        document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
    };

    const currentResults = type === "illust" ? illustState : userState;
    const hasNext =
        currentResults.status === "success" &&
        (type === "illust"
            ? (currentResults.data as IllustPage).next_offset != null
            : (currentResults.data as UserPreviewPage).next_offset != null);
    const showResults = keyword.length > 0;

    return (
        <div className="relative flex flex-col gap-4 px-7 pt-4 pb-7">
            <SearchBar defaultValue={keyword} autoFocus={!keyword} />

            {!showResults && <SearchEmptyState />}

            {showResults && (
                <>
                    <Tabs value={type} onValueChange={onTabChange}>
                        <div className="border-muted/60 border-b">
                            <TabsList variant="line" className="h-12 gap-0">
                                <TabsTrigger
                                    value="illust"
                                    className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                                >
                                    作品
                                </TabsTrigger>
                                <TabsTrigger
                                    value="user"
                                    className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                                >
                                    用户
                                </TabsTrigger>
                            </TabsList>
                        </div>
                    </Tabs>

                    {type === "illust" && (
                        <SearchFilters
                            target={target}
                            sort={sort}
                            onTargetChange={(t) =>
                                updateParams({ target: t === DEFAULT_SEARCH_TARGET ? undefined : t }, true)
                            }
                            onSortChange={(s) =>
                                updateParams({ sort: s === DEFAULT_SEARCH_SORT ? undefined : s }, true)
                            }
                        />
                    )}

                    {type === "illust" ? (
                        <>
                            {illustState.status === "loading" && <IllustGridSkeleton />}
                            {illustState.status === "error" && <SearchError error={illustState.error} />}
                            {illustState.status === "success" &&
                                (illustState.data.illusts.length === 0 ? (
                                    <SearchNoResults word={keyword} />
                                ) : (
                                    <IllustGrid
                                        illusts={illustState.data.illusts}
                                        selected={selected}
                                        onToggle={toggle}
                                    />
                                ))}
                        </>
                    ) : (
                        <>
                            {userState.status === "loading" && <UserListSkeleton />}
                            {userState.status === "error" && <SearchError error={userState.error} />}
                            {userState.status === "success" &&
                                (userState.data.user_previews.length === 0 ? (
                                    <SearchNoResults word={keyword} />
                                ) : (
                                    <UserList previews={userState.data.user_previews} />
                                ))}
                        </>
                    )}

                    {currentResults.status === "success" && (
                        <SearchPager currentPage={page} hasNext={hasNext} onJump={onJumpPage} />
                    )}
                </>
            )}

            {type === "illust" && (
                <DownloadFAB selectedIllustIds={selectedIllustIds} onClearSelection={clearSelection} />
            )}
        </div>
    );
}

export default SearchPage;
