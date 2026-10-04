import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { Restrict } from "./api";
import { bookmarkTagsOptions, cachedStateOptions, knownTagsKey } from "./bookmark-state";

export function useBookmarkTags(userId: number | null | undefined, restrict: Restrict, enabled = true) {
    const client = useQueryClient();
    const query = useInfiniteQuery({
        ...bookmarkTagsOptions(userId ?? 0, restrict),
        enabled: enabled && userId != null,
    });
    const known = useQuery(cachedStateOptions<string[]>(knownTagsKey(userId ?? 0, restrict), []));
    useEffect(() => {
        if (!query.data) return;
        const indexed = new Set(query.data.pages.flatMap((page) => page.bookmark_tags.map((tag) => tag.name)));
        client.setQueryData<string[]>(knownTagsKey(userId ?? 0, restrict), (old) => {
            if (!old?.some((name) => indexed.has(name))) return old;
            return old.filter((name) => !indexed.has(name));
        });
    }, [query.data, client, userId, restrict]);
    const entries = useMemo(() => {
        const indexed = new Map<string, { name: string; count: number | null }>();
        for (const page of query.data?.pages ?? []) for (const tag of page.bookmark_tags) indexed.set(tag.name, tag);
        for (const name of known.data ?? []) if (!indexed.has(name)) indexed.set(name, { name, count: null });
        return [...indexed.values()];
    }, [query.data, known.data]);
    return { ...query, entries };
}
