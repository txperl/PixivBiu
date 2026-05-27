import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { listRanking } from "@/features/ranking/api";
import {
    extractTopTags,
    readTrendingCache,
    type TrendingTag,
    writeTrendingCache,
} from "@/features/search/trending-tags";
import { useMessages } from "@/i18n";

const TRENDING_LIMIT = 18;

type State = { status: "loading" } | { status: "ready"; tags: TrendingTag[] } | { status: "error" };

function DiscoveryTrending() {
    const m = useMessages();
    const navigate = useNavigate();
    const [state, setState] = useState<State>(() => {
        const cached = readTrendingCache();
        return cached && cached.length > 0 ? { status: "ready", tags: cached } : { status: "loading" };
    });

    useEffect(() => {
        if (state.status !== "loading") return;
        let cancelled = false;
        listRanking({ mode: "day" }).then(({ data, error }) => {
            if (cancelled) return;
            if (error || !data) {
                setState({ status: "error" });
                return;
            }
            const tags = extractTopTags(data.illusts, TRENDING_LIMIT);
            writeTrendingCache(tags);
            setState({ status: "ready", tags });
        });
        return () => {
            cancelled = true;
        };
    }, [state.status]);

    const go = (name: string) => {
        navigate(`/search/${encodeURIComponent(name)}`);
    };

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
                <h2 className="m-0 font-medium text-2xl text-foreground leading-tight">{m.search_trending_title()}</h2>
                <span className="font-mono text-muted-foreground text-xs">{m.search_trending_daily()}</span>
            </div>
            {state.status === "loading" && (
                <div className="flex flex-wrap gap-2">
                    {Array.from({ length: 10 }).map((_, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                        <Skeleton key={i} className="h-7 w-18 rounded-full" />
                    ))}
                </div>
            )}
            {state.status === "error" && (
                <div className="text-muted-foreground text-sm">{m.search_trending_error()}</div>
            )}
            {state.status === "ready" &&
                (state.tags.length === 0 ? (
                    <div className="text-lg text-muted-foreground">{m.common_empty()}</div>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {state.tags.map((t) => (
                            <button
                                key={t.name}
                                type="button"
                                onClick={() => go(t.name)}
                                title={t.label === t.name ? undefined : t.name}
                                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-input px-2.5 text-muted-foreground text-xs transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                            >
                                <span className="max-w-[180px] truncate">{t.label}</span>
                                <span className="font-mono text-[10px] text-muted-foreground/80">{t.count}</span>
                            </button>
                        ))}
                    </div>
                ))}
        </section>
    );
}

export default DiscoveryTrending;
