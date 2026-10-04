import { useEffect, useMemo, useRef, useState } from "react";
import {
    type BookmarkStatus,
    type BookmarkStatusState,
    bookmarkStatus,
    registeredBookmarkTags,
} from "./bookmark-state";
import { createBookmarkTagWriter } from "./bookmark-tag-writer";
import type { IllustBookmark } from "./use-illust-bookmark";

// Query owns saved metadata. Local selection exists only for an accepted tag batch.
export function useBookmarkEditor(bookmark: IllustBookmark) {
    const detail = bookmark.detailQuery;
    const registered = useMemo(() => registeredBookmarkTags(detail.data), [detail.data]);
    const [ready, setReady] = useState(false);
    const [selection, setSelection] = useState<string[]>([]);
    const [tagSaving, setTagSaving] = useState(false);
    const mounted = useRef(false);
    const writer = useRef<ReturnType<typeof createBookmarkTagWriter> | null>(null);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        if (writer.current) {
            if (!tagSaving && !bookmark.pending && detail.data) writer.current.synchronize(registered);
            return;
        }
        if (bookmark.pending || detail.isFetching || detail.isError || !detail.data) return;
        writer.current = createBookmarkTagWriter({
            initial: registered,
            // Capture this account/artwork's command. A queued edit must never bind
            // itself to a new account; the command also checks session generation.
            save: (next) => bookmark.save(undefined, next),
            onChange: (next) => {
                if (mounted.current) setSelection(next);
            },
            onSaving: (saving) => {
                if (mounted.current) setTagSaving(saving);
            },
        });
        setReady(true);
    }, [detail.data, detail.isFetching, detail.isError, bookmark.pending, bookmark.save, registered, tagSaving]);

    const phase = ready && detail.data ? "ready" : detail.isError && !detail.isFetching ? "error" : "loading";
    const saving = tagSaving || bookmark.pending;
    const status: BookmarkStatusState =
        phase === "ready" && detail.data
            ? { phase, value: bookmarkStatus(detail.data), disabled: saving }
            : { phase: phase === "error" ? "error" : "loading" };
    const changeTags = (tags: string[]) => {
        const current = writer.current;
        if (phase !== "ready" || !current || (bookmark.pending && !current.pending)) return false;
        if (!current.pending) current.synchronize(registered);
        current.change(tags);
        return true;
    };
    const changeStatus = (value: BookmarkStatus) => {
        if (status.phase !== "ready" || bookmark.pending || writer.current?.pending || value === status.value) return;
        if (value === "none") void bookmark.remove();
        else void bookmark.save(value);
    };
    return {
        status,
        values: phase === "ready" && tagSaving ? selection : registered,
        loading: phase === "loading",
        saving,
        tagsDisabled: phase !== "ready" || (bookmark.pending && !tagSaving),
        changeTags,
        changeStatus,
    };
}
