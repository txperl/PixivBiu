import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { useSearchHistory } from "@/features/search/hooks/use-search-history";
import { useMessages } from "@/i18n";
import { CloseIcon } from "@/lib/icons";

function DiscoveryRecent() {
    const m = useMessages();
    const navigate = useNavigate();
    const { items, remove, clear } = useSearchHistory();

    const go = (keyword: string) => {
        navigate(`/search/${encodeURIComponent(keyword)}`);
    };

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                    <h2 className="m-0 font-medium text-2xl text-foreground leading-tight">
                        {m.search_recent_title()}
                    </h2>
                </div>
                {items.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={clear}>
                        {m.common_clear()}
                    </Button>
                )}
            </div>
            {items.length === 0 ? (
                <div className="text-lg text-muted-foreground">{m.common_empty()}</div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {items.map((keyword) => (
                        <span
                            key={keyword}
                            className="inline-flex h-7 items-center gap-1 rounded-full bg-secondary pr-2 pl-3 text-secondary-foreground text-xs"
                        >
                            <button
                                type="button"
                                onClick={() => go(keyword)}
                                className="max-w-[220px] truncate text-left hover:text-foreground"
                            >
                                {keyword}
                            </button>
                            <button
                                type="button"
                                aria-label={m.search_recent_remove({ keyword })}
                                onClick={() => remove(keyword)}
                                className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                            >
                                <HugeiconsIcon icon={CloseIcon} size={11} strokeWidth={2.5} />
                            </button>
                        </span>
                    ))}
                </div>
            )}
        </section>
    );
}

export default DiscoveryRecent;
