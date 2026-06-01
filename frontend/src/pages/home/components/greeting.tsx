import StatCard from "@/components/stat-card";
import { useMessages } from "@/i18n";
import { useGreeting } from "../use-greeting";

function Greeting() {
    const m = useMessages();
    const greeting = useGreeting();
    return (
        <section>
            <div className="mb-4 flex items-end gap-3.5">
                <div>
                    <h1 className="m-0 font-normal text-3xl text-foreground leading-tight">{greeting}</h1>
                    <p className="mt-2 mb-0 text-muted-foreground text-sm">{m.home_greeting_meta({ count: 48 })}</p>
                </div>
                <div className="flex-1" />
                <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-muted-foreground text-xs">
                    <span className="size-2 rounded-full bg-primary" />
                    {m.home_synced()}
                </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
                <StatCard label={m.home_stat_following()} value="12" delta={m.home_stat_following_delta()} />
                <StatCard label={m.home_stat_bookmarks()} value="284" delta={m.home_stat_bookmarks_delta()} />
                <StatCard label={m.home_stat_downloaded()} value="1,420" delta="6.8 GB" mono />
                <StatCard label={m.home_stat_downloading()} value="2" delta="19.2 MB · 49%" accent />
            </div>
        </section>
    );
}

export default Greeting;
