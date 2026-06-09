import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Illust } from "@/features/illusts/api";

// An Illust is the only cached shape carrying all three of these — enough to
// tell it apart from sibling entities (User/UserPreview have `id` but not the
// bookmark fields) without importing a runtime type tag.
function isIllust(v: Record<string, unknown>): boolean {
    return "id" in v && "is_bookmarked" in v && "total_bookmarks" in v;
}

// Walk an arbitrary cached value and return a copy with every Illust whose id
// matches `id` run through `apply`. Structural sharing: a container is cloned only
// once one of its descendants actually changes — unchanged subtrees keep their
// identity (so unrelated cards don't re-render) and cost no allocation. Recursion
// stops at Illust boundaries (illusts don't nest illusts), bounding the walk.
function patchIllusts(value: unknown, id: number, apply: (illust: Illust) => Illust): unknown {
    if (Array.isArray(value)) {
        let next: unknown[] | null = null;
        for (let i = 0; i < value.length; i++) {
            const updated = patchIllusts(value[i], id, apply);
            if (updated === value[i]) continue;
            if (!next) next = value.slice();
            next[i] = updated;
        }
        return next ?? value;
    }
    if (value !== null && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if (isIllust(obj)) {
            return obj.id === id ? apply(obj as unknown as Illust) : value;
        }
        let next: Record<string, unknown> | null = null;
        for (const key of Object.keys(obj)) {
            const updated = patchIllusts(obj[key], id, apply);
            if (updated === obj[key]) continue;
            if (!next) next = { ...obj };
            next[key] = updated;
        }
        return next ?? value;
    }
    return value;
}

// Write-through patch for a single illust across EVERY cached query that embeds
// it — infinite/flat illust pages, user-preview lists (nested `illusts`), and the
// detail query. Lets a mutation in one component (e.g. the viewer footer) reflect
// instantly on every other instance (e.g. the grid card behind it), which local
// optimistic state alone can't do. Shape-agnostic on purpose, mirroring
// useInvalidateIllustLists: a new illust-bearing query type needs no change here.
export function usePatchCachedIllust() {
    const queryClient = useQueryClient();
    return useCallback(
        (illustId: number, patch: Partial<Illust>) => {
            queryClient.setQueriesData({}, (data: unknown) =>
                patchIllusts(data, illustId, (illust) => ({ ...illust, ...patch })),
            );
        },
        [queryClient],
    );
}
