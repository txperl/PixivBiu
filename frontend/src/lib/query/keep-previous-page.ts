import type { QueryKey } from "@tanstack/react-query";

// A `placeholderData` builder that keeps the prior page on screen ONLY while the list
// identity is unchanged — i.e. when just a pagination field differs (offset / max_bookmark_id).
// On an identity change (different user / keyword / filters / tab / restrict / tag) it returns
// undefined, so the page shows a skeleton for the new list instead of the previous list's data
// lingering as "success" under the new URL — which would otherwise drive the pager, batch
// actions, or the bookmark cursor chain off the wrong results. Plain `keepPreviousData` keeps
// data across EVERY key change, which is the bug this guards against.
//
// `current` is the params object passed to the query factory (it becomes queryKey[1]);
// `pageKeys` names the field(s) allowed to differ while still keeping the previous page.
export function keepPreviousPage<P extends Record<string, unknown>>(current: P, pageKeys: ReadonlyArray<keyof P>) {
    return <TData>(prev: TData | undefined, prevQuery: { queryKey: QueryKey } | undefined): TData | undefined => {
        if (prev === undefined || !prevQuery) return undefined;
        const previous = prevQuery.queryKey[1] as P | undefined;
        if (!previous) return undefined;
        for (const key of Object.keys(current) as Array<keyof P>) {
            if (!pageKeys.includes(key) && current[key] !== previous[key]) return undefined;
        }
        return prev;
    };
}
