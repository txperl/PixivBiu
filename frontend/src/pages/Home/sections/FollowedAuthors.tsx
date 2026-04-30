import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FollowIcon } from "@/lib/icons";
import Avatar from "../components/Avatar";
import { Sheet, SheetHead } from "../components/Sheet";
import { PB_AUTHORS, PB_WORKS } from "../mock-data";

function FollowedAuthors() {
    const authors = PB_AUTHORS.slice(0, 5);
    return (
        <Sheet>
            <SheetHead
                icon={FollowIcon}
                title="关注作者"
                meta="12 · 5 有新作"
                actions={
                    <Button variant="ghost" size="sm">
                        管理
                    </Button>
                }
            />
            <div>
                {authors.map((a, i) => {
                    const works = PB_WORKS.filter((w) => w.author.id === a.id).slice(0, 3);
                    const slots = [0, 1, 2].map((slot) => ({
                        key: `${a.id}-slot-${slot}`,
                        work: works[slot] ?? null,
                    }));
                    return (
                        <div
                            key={a.id}
                            className={`flex items-center gap-3 px-[18px] py-2.5 ${i === 0 ? "" : "border-muted/40 border-t"}`}
                        >
                            <Avatar hue={a.hue} initial={a.name[0]} size={32} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-foreground text-sm">{a.name}</div>
                                <div className="font-mono text-[11px] text-muted-foreground">@{a.handle}</div>
                            </div>
                            <div className="flex gap-[3px]">
                                {slots.map(({ key, work }) =>
                                    work ? (
                                        <div
                                            key={key}
                                            className="size-[22px] rounded-md"
                                            style={{ background: `oklch(0.86 0.06 ${work.hue})` }}
                                        />
                                    ) : (
                                        <div key={key} className="size-[22px] rounded-md bg-muted/60" />
                                    ),
                                )}
                            </div>
                            {i < 3 ? (
                                <Badge className="font-mono">+{1 + (i % 3)}</Badge>
                            ) : (
                                <span className="font-mono text-[11px] text-muted-foreground">{i + 1}h</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </Sheet>
    );
}

export default FollowedAuthors;
