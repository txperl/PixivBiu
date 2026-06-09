import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
    addBookmark,
    deleteBookmark,
    getBookmarkDetail,
    type IllustApiError,
    illustDetailQueryKey,
    type Restrict,
} from "@/features/illusts/api";
import { usePatchCachedIllust } from "@/features/illusts/use-patch-cached-illust";
import { useApiErrorMessage } from "@/lib/api";
import { useInvalidateIllustLists } from "@/lib/query/use-invalidate-illust-lists";

type UseIllustBookmarkArgs = {
    illustId: number;
    // Current bookmark state, read live from the cache-backed Illust prop (NOT a
    // one-time seed): the cache is the single source of truth and these update as
    // the optimistic patch / refetch rewrites it.
    isBookmarked: boolean;
    bookmarkCount: number;
};

type BookmarkVars = { add: boolean; restrict: Restrict };
type BookmarkSnapshot = { isBookmarked: boolean; bookmarkCount: number; restrict: Restrict | null };

// Shared bookmark logic for the card's count button and the viewer's action cell.
// Single source of truth = the query cache. The mutation follows TanStack Query's
// canonical optimistic lifecycle so the three places bookmark state used to live
// (local component state, the many cached Illust copies, and the in-flight detail
// fetch) can no longer drift or race:
//   onMutate  — cancel the in-flight /illusts/{id} fetch (so it can't resolve with
//               pre-mutation data and clobber the write), then optimistically patch
//               every cached copy of this illust; snapshot for rollback.
//   onError   — restore the snapshot.
//   onSettled — invalidate so the next list visit reconciles the server's real
//               (global, drifting) total_bookmarks.
// No parallel local optimistic state: bookmarked/count come straight from the
// cache-backed props, so card, viewer, and detail always agree.
export type IllustBookmark = ReturnType<typeof useIllustBookmark>;
export function useIllustBookmark({ illustId, isBookmarked, bookmarkCount }: UseIllustBookmarkArgs) {
    const queryClient = useQueryClient();
    const resolveApiError = useApiErrorMessage();
    const patchCachedIllust = usePatchCachedIllust();
    const invalidateIllustLists = useInvalidateIllustLists();
    const [errorTitle, setErrorTitle] = useState<string | null>(null);
    const [popoverOpen, setPopoverOpen] = useState(false);
    // null = unknown (either not bookmarked, or bookmarked but detail not yet fetched).
    const [currentRestrict, setCurrentRestrict] = useState<Restrict | null>(null);
    const [restrictLoading, setRestrictLoading] = useState(false);
    const [popVersion, setPopVersion] = useState(0);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Bumped on each mutation; lazy restrict-fetch results from a stale generation are discarded.
    const opGenRef = useRef(0);

    useEffect(
        () => () => {
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        },
        [],
    );

    const mutation = useMutation<void, IllustApiError, BookmarkVars, BookmarkSnapshot>({
        mutationFn: async ({ add, restrict }) => {
            const { error } = add ? await addBookmark(illustId, restrict) : await deleteBookmark(illustId);
            if (error) throw error;
        },
        onMutate: async ({ add, restrict }) => {
            // Cancel every in-flight refetch that could resolve with pre-mutation data and
            // revert the optimistic write below — the viewer's detail backfill AND any list
            // the card sits in that's refetching (e.g. a grid refreshing after a stale
            // mount). Scoped precisely so we don't break unrelated fetches:
            //  - data !== undefined: a first-load query holds nothing for the patch to
            //    clobber, so leave it to finish instead of stranding it pending.
            //  - fetchMeta.fetchMore == null: a full refetch replaces existing rows (the
            //    clobber); an infinite list's "load more" only appends, so let it run.
            await queryClient.cancelQueries({
                predicate: (query) => query.state.data !== undefined && query.state.fetchMeta?.fetchMore == null,
            });
            opGenRef.current++;
            const snapshot: BookmarkSnapshot = { isBookmarked, bookmarkCount, restrict: currentRestrict };
            const nextCount = add ? (isBookmarked ? bookmarkCount : bookmarkCount + 1) : Math.max(0, bookmarkCount - 1);
            patchCachedIllust(illustId, { is_bookmarked: add, total_bookmarks: nextCount });
            setCurrentRestrict(add ? restrict : null);
            if (add && !isBookmarked) setPopVersion((v) => v + 1);
            setErrorTitle(null);
            return snapshot;
        },
        onError: (error, _vars, snapshot) => {
            if (snapshot) {
                patchCachedIllust(illustId, {
                    is_bookmarked: snapshot.isBookmarked,
                    total_bookmarks: snapshot.bookmarkCount,
                });
                setCurrentRestrict(snapshot.restrict);
            }
            setErrorTitle(resolveApiError(error));
        },
        onSettled: () => {
            // onMutate cancelled the viewer's in-flight detail backfill; restart it so
            // the open viewer fills in meta_pages/original and reconciles is_bookmarked
            // instead of staying stuck on incomplete seed data. Default refetchType
            // "active" scopes this to the open viewer — closed/unmounted detail queries
            // just refetch on their next open. Lists stay patch-only (no per-toggle
            // refetch storm), since the optimistic write already updated them.
            queryClient.invalidateQueries({ queryKey: illustDetailQueryKey(illustId) });
            invalidateIllustLists();
        },
    });

    const bookmarked = isBookmarked;
    const count = bookmarkCount;
    const pending = mutation.isPending;

    const openPopover = () => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        setPopoverOpen(true);
        if (bookmarked && currentRestrict === null && !restrictLoading) {
            const myGen = opGenRef.current;
            setRestrictLoading(true);
            getBookmarkDetail(illustId).then(({ data, error }) => {
                if (opGenRef.current === myGen && !error && data?.is_bookmarked) {
                    setCurrentRestrict(data.restrict);
                }
                setRestrictLoading(false);
            });
        }
    };

    // Bridge the gap between trigger button and popover so cursor transit doesn't dismiss it.
    const scheduleClose = () => {
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        closeTimerRef.current = setTimeout(() => setPopoverOpen(false), 120);
    };

    // Plain click defaults to public (same as the card); private is chosen via the
    // popover's pickRestrict.
    const toggle = () => {
        if (pending) return;
        mutation.mutate({ add: !bookmarked, restrict: "public" });
    };

    const pickRestrict = (restrict: Restrict) => {
        if (pending) return;
        if (bookmarked && currentRestrict === restrict) return;
        mutation.mutate({ add: true, restrict });
    };

    return {
        bookmarked,
        count,
        pending,
        errorTitle,
        currentRestrict,
        restrictLoading,
        popoverOpen,
        setPopoverOpen,
        popVersion,
        buttonRef,
        openPopover,
        scheduleClose,
        toggle,
        pickRestrict,
    };
}
