import { useQuery } from "@tanstack/react-query";
import { SEARCH_PAGE_SIZE } from "@/features/search/api";
import { configQueryOptions } from "@/features/settings/api";

// Mirrors the backend default for search.sample.pages (internal/config/config.go).
// Used while config loads and when the value is missing/invalid.
export const DEFAULT_RANKED_SAMPLE_PAGES = 5;

function readSamplePages(effective: unknown): number {
    const search = (effective as { search?: { sample?: { pages?: unknown } } } | undefined)?.search;
    const pages = search?.sample?.pages;
    return typeof pages === "number" && pages >= 1 ? Math.floor(pages) : DEFAULT_RANKED_SAMPLE_PAGES;
}

// Ranked sorts (bookmarks_desc / views_desc) page in disjoint windows of
// SEARCH_PAGE_SIZE * sample.pages — matching how many upstream pages the backend
// re-ranks per response — so the frontend's offset stepping lines up with the
// server's windows. Reads the live config so a settings change re-sizes the
// window; the default matches the backend default, so page 1 (offset 0) is always
// correct even before config resolves. Pass `enabled: false` to skip the fetch
// when no ranked sort is active.
export function useRankedPageSize(enabled = true): number {
    const { data } = useQuery({ ...configQueryOptions(), enabled });
    return SEARCH_PAGE_SIZE * readSamplePages(data?.effective);
}
