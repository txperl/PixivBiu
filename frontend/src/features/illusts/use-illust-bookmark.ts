import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useAuth } from "@/features/auth";
import { useMessages } from "@/i18n";
import { useApiErrorMessage } from "@/lib/api";
import { useInvalidateIllustLists } from "@/lib/query/use-invalidate-illust-lists";
import { useChangeEffect } from "@/lib/use-change-effect";
import {
    addBookmark,
    type BookmarkDetail,
    deleteBookmark,
    type IllustApiError,
    illustDetailQueryKey,
    type Restrict,
} from "./api";
import {
    bookmarkDetailKey,
    bookmarkDetailOptions,
    bookmarkEditorNavigationIdentity,
    invalidateBookmarkMembership,
    normalizeBookmarkTags,
    rememberBookmarkTags,
    validBookmarkTags,
} from "./bookmark-state";
import { usePatchCachedIllust } from "./use-patch-cached-illust";

type Args = { illustId: number; isBookmarked: boolean; bookmarkCount: number; loadDetail?: boolean };
type Vars = { add: boolean; restrict?: Restrict; tags?: string[]; generation: number; controller: AbortController };
type Snapshot = { bookmarked: boolean; count: number; detail: BookmarkDetail | undefined; generation: number };
export type IllustBookmark = ReturnType<typeof useIllustBookmark>;

export function useIllustBookmark({ illustId, isBookmarked, bookmarkCount, loadDetail = false }: Args) {
    const { status, session } = useAuth();
    const account = `${session.current.key}:${session.current.generation}`;
    const client = useQueryClient();
    const patch = usePatchCachedIllust();
    const invalidateLists = useInvalidateIllustLists();
    const resolveError = useApiErrorMessage();
    const m = useMessages();
    const [errorTitle, setErrorTitle] = useState<string | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [quickEditorOpen, setQuickEditorOpenState] = useState(false);
    const [keyboardPopover, setKeyboardPopover] = useState(false);
    const [popVersion, setPopVersion] = useState(0);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const quickOpen = useRef(false);
    const key = bookmarkDetailKey(account, illustId);
    const mutationKey = ["bookmark-mutation", account, illustId] as const;
    const pendingCount = useIsMutating({ mutationKey, exact: true });
    const detailQuery = useQuery({
        ...bookmarkDetailOptions(account, illustId),
        enabled:
            !!status?.authenticated && (loadDetail || editorOpen || quickEditorOpen || (popoverOpen && isBookmarked)),
    });
    const bookmarked = detailQuery.data?.is_bookmarked ?? isBookmarked;
    const generation = session.current.generation;
    const location = useLocation();
    const navigationIdentity = bookmarkEditorNavigationIdentity(illustId, location.pathname, location.search);
    useChangeEffect(JSON.stringify([generation, illustId, navigationIdentity]), () => {
        setEditorOpen(false);
        setPopoverOpen(false);
        quickOpen.current = false;
        setQuickEditorOpenState(false);
        setErrorTitle(null);
    });
    useEffect(
        () => () => {
            if (closeTimer.current) clearTimeout(closeTimer.current);
        },
        [],
    );

    const mutation = useMutation<void, IllustApiError, Vars, Snapshot>({
        mutationKey,
        scope: { id: JSON.stringify(mutationKey) },
        retry: false,
        networkMode: "always",
        mutationFn: async (vars) => {
            if (session.current.generation !== vars.generation)
                throw { code: "unauthenticated", kind: "app", message: "" } satisfies IllustApiError;
            const { error } = vars.add
                ? await addBookmark(illustId, { restrict: vars.restrict, tags: vars.tags }, vars.controller.signal)
                : await deleteBookmark(illustId, vars.controller.signal);
            if (error) throw error;
        },
        onMutate: async (vars) => {
            await client.cancelQueries({
                predicate: (query) =>
                    JSON.stringify(query.queryKey) === JSON.stringify(key) ||
                    (query.state.data !== undefined &&
                        query.state.fetchMeta?.fetchMore == null &&
                        query.meta?.skipListInvalidation !== true),
            });
            if (session.current.generation !== vars.generation)
                throw { code: "unauthenticated", kind: "app", message: "" } satisfies IllustApiError;
            const snapshot = {
                bookmarked,
                count: bookmarkCount,
                detail:
                    client.getQueryData<BookmarkDetail>(key) ??
                    (!bookmarked ? { is_bookmarked: false, restrict: "public", tags: [] } : undefined),
                generation: vars.generation,
            };
            snapshot.bookmarked = snapshot.detail?.is_bookmarked ?? bookmarked;
            let observed = false;
            patch(illustId, (illust) => {
                if (!observed) {
                    snapshot.count = illust.total_bookmarks;
                    observed = true;
                }
                const wasBookmarked = snapshot.detail?.is_bookmarked ?? illust.is_bookmarked;
                const count = vars.add
                    ? illust.total_bookmarks + (wasBookmarked ? 0 : 1)
                    : Math.max(0, illust.total_bookmarks - (wasBookmarked ? 1 : 0));
                return { ...illust, is_bookmarked: vars.add, total_bookmarks: count };
            });
            if (snapshot.detail)
                client.setQueryData<BookmarkDetail>(key, {
                    ...snapshot.detail,
                    is_bookmarked: vars.add,
                    restrict: vars.restrict ?? snapshot.detail.restrict,
                    tags: !vars.add
                        ? []
                        : vars.tags
                          ? vars.tags.map((name) => ({ name, is_registered: true }))
                          : snapshot.detail.tags,
                });
            if (vars.add && !snapshot.bookmarked) setPopVersion((v) => v + 1);
            setErrorTitle(null);
            return snapshot;
        },
        onError: (error, vars, snapshot) => {
            if (session.current.generation !== vars.generation) return;
            if (snapshot) {
                patch(illustId, { is_bookmarked: snapshot.bookmarked, total_bookmarks: snapshot.count });
                if (snapshot.detail) client.setQueryData(key, snapshot.detail);
            }
            setErrorTitle(error.fields?.tags ? m.bookmark_tag_invalid() : resolveError(error));
        },
        onSuccess: (_data, vars, snapshot) => {
            if (session.current.generation !== vars.generation) return;
            if (!vars.add)
                client.setQueryData<BookmarkDetail>(key, { is_bookmarked: false, restrict: "public", tags: [] });
            else if (vars.tags && vars.restrict)
                client.setQueryData<BookmarkDetail>(key, {
                    is_bookmarked: true,
                    restrict: vars.restrict,
                    tags: vars.tags.map((name) => ({ name, is_registered: true })),
                });
            if (status?.user_id != null) {
                const restrict = vars.restrict ?? snapshot?.detail?.restrict;
                if (vars.add && vars.tags && (restrict === "public" || restrict === "private"))
                    rememberBookmarkTags(client, status.user_id, restrict, vars.tags);
                invalidateBookmarkMembership(
                    client,
                    status.user_id,
                    snapshot?.detail,
                    client.getQueryData<BookmarkDetail>(key),
                );
                void client.invalidateQueries({ queryKey: ["bookmark-tags", status.user_id] });
                void client.invalidateQueries({ queryKey: ["user-detail", status.user_id] });
            }
        },
        onSettled: (_data, _error, vars) => {
            if (session.current.generation !== vars.generation) return;
            void client.invalidateQueries({ queryKey: key, exact: true });
            void client.invalidateQueries({ queryKey: illustDetailQueryKey(illustId) });
            invalidateLists();
        },
    });
    const submit = async (add: boolean, restrict?: Restrict, tags?: string[]) => {
        if (session.current.generation !== generation || session.current.signal.aborted) return false;
        if (client.isMutating({ mutationKey, exact: true }) > 0) return false;
        const normalized = tags == null ? undefined : normalizeBookmarkTags(tags);
        if (normalized && !validBookmarkTags(normalized)) {
            setErrorTitle(m.bookmark_tag_invalid());
            return false;
        }
        const controller = new AbortController();
        const signal = session.current.signal;
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        try {
            await mutation.mutateAsync({
                add,
                restrict,
                tags: normalized,
                generation: session.current.generation,
                controller,
            });
            return session.current.generation === generation;
        } catch {
            return false;
        } finally {
            signal.removeEventListener("abort", abort);
        }
    };
    const openEditor = () => {
        if (pendingCount > 0) return;
        setPopoverOpen(false);
        setErrorTitle(null);
        setEditorOpen(true);
        void client.invalidateQueries({ queryKey: key, exact: true });
    };
    const keepPopoverOpen = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = null;
    };
    const openPopover = () => {
        keepPopoverOpen();
        if (pendingCount > 0) return;
        setKeyboardPopover(false);
        setPopoverOpen(true);
    };
    const scheduleClose = () => {
        keepPopoverOpen();
        closeTimer.current = setTimeout(() => {
            closeTimer.current = null;
            // A nested hover popup can finish closing after the pointer has already
            // returned to this chooser, so recheck hover before dismissing it.
            if (
                quickOpen.current ||
                buttonRef.current?.matches(":hover") ||
                popoverRef.current?.matches(":hover") ||
                popoverRef.current?.contains(document.activeElement)
            )
                return;
            setPopoverOpen(false);
        }, 180);
    };
    const setQuickEditorOpen = (open: boolean) => {
        if (open && pendingCount > 0) return;
        quickOpen.current = open;
        setQuickEditorOpenState(open);
        setErrorTitle(null);
        if (open) {
            keepPopoverOpen();
            void client.invalidateQueries({ queryKey: key, exact: true });
        }
    };
    const restrict = detailQuery.data?.restrict;
    return {
        bookmarked,
        count: bookmarkCount,
        pending: pendingCount > 0,
        errorTitle,
        currentRestrict: bookmarked && (restrict === "public" || restrict === "private") ? restrict : null,
        restrictLoading: bookmarked && detailQuery.isFetching,
        detailQuery,
        editorOpen,
        setEditorOpen,
        openEditor,
        popoverOpen,
        setPopoverOpen,
        quickEditorOpen,
        setQuickEditorOpen,
        keyboardPopover,
        buttonRef,
        popoverRef,
        openPopover,
        keepPopoverOpen,
        scheduleClose,
        onPopoverKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            event.stopPropagation();
            keepPopoverOpen();
            setKeyboardPopover(true);
            setPopoverOpen(true);
        },
        popVersion,
        toggle: () => {
            void submit(!bookmarked, !bookmarked ? "public" : undefined);
        },
        pickRestrict: (value: Restrict) => {
            if (bookmarked && restrict === value) return;
            void submit(true, value);
        },
        save: (value: Restrict | undefined, tags?: string[]) => submit(true, value, tags),
        remove: () => submit(false),
    };
}
