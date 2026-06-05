import { queryOptions } from "@tanstack/react-query";
import { api, type components, unwrap } from "@/lib/api";

export type RankingMode = components["schemas"]["RankingMode"];
export type IllustPage = components["schemas"]["IllustPage"];
export type Illust = components["schemas"]["Illust"];
export type RankingApiError = components["schemas"]["Error"];

export const RANKING_PAGE_SIZE = 30;

export const RANKING_PERIODS = ["day", "week", "month"] as const;
export type RankingPeriod = (typeof RANKING_PERIODS)[number];

// Variants carry a stable `key` only — the human-readable label is resolved in
// the consuming component (ranking-filters.tsx) via useMessages(), so labels
// stay locale-aware without baking UI text into this non-component module.
export const RANKING_VARIANTS = {
    day: [
        { key: "all", mode: "day" },
        { key: "male", mode: "day_male" },
        { key: "female", mode: "day_female" },
        { key: "manga", mode: "day_manga" },
        { key: "r18", mode: "day_r18" },
        { key: "male_r18", mode: "day_male_r18" },
        { key: "female_r18", mode: "day_female_r18" },
    ],
    week: [
        { key: "all", mode: "week" },
        { key: "original", mode: "week_original" },
        { key: "rookie", mode: "week_rookie" },
        { key: "r18", mode: "week_r18" },
        { key: "r18g", mode: "week_r18g" },
    ],
    month: [{ key: "all", mode: "month" }],
} as const satisfies Record<RankingPeriod, ReadonlyArray<{ key: string; mode: RankingMode }>>;

export type RankingVariant = (typeof RANKING_VARIANTS)[RankingPeriod][number];
export type RankingVariantKey = RankingVariant["key"];

export const DEFAULT_RANKING_MODE: RankingMode = "day";

const RANKING_MODES: ReadonlySet<string> = new Set(
    Object.values(RANKING_VARIANTS).flatMap((variants) => variants.map((v) => v.mode)),
);

export function isRankingMode(v: string | null | undefined): v is RankingMode {
    return v != null && RANKING_MODES.has(v);
}

export function periodOf(mode: RankingMode): RankingPeriod {
    for (const period of RANKING_PERIODS) {
        if (RANKING_VARIANTS[period].some((v) => v.mode === mode)) return period;
    }
    return "day";
}

export function variantKeyOf(mode: RankingMode): RankingVariantKey {
    const period = periodOf(mode);
    return RANKING_VARIANTS[period].find((v) => v.mode === mode)?.key ?? "all";
}

export function modeFor(period: RankingPeriod, variantKey: RankingVariantKey): RankingMode {
    const variants = RANKING_VARIANTS[period];
    return (variants.find((v) => v.key === variantKey) ?? variants[0]).mode;
}

export type ListRankingParams = {
    mode?: RankingMode;
    date?: string;
    offset?: number;
};

export async function listRanking(
    params: ListRankingParams,
): Promise<{ data: IllustPage | null; error: RankingApiError | null }> {
    const { data, error } = await api.GET("/illusts/ranking", {
        params: {
            query: {
                mode: params.mode,
                date: params.date,
                offset: params.offset,
            },
        },
    });
    return { data: data ?? null, error: error ?? null };
}

// Data-fetching convention (see AGENTS.md): each features/<domain>/api.ts exports
// a <domain>QueryOptions(params) factory. Query key is ["<domain>", params] — a
// single object param so adding a field later doesn't reshuffle positional keys
// (TanStack hashes object keys order-independently). The generics pin TError to
// RankingApiError so useQuery().error is typed; unwrap() turns the never-throw
// { data, error } wrapper into Query's throw-on-error contract. Components call
// useQuery(rankingQueryOptions(...)) and never touch openapi-fetch directly.
export function rankingQueryOptions(params: ListRankingParams) {
    return queryOptions<IllustPage, RankingApiError>({
        queryKey: ["ranking", params],
        queryFn: () => listRanking(params).then(unwrap),
    });
}
