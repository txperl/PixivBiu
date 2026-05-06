import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDownIcon } from "@/lib/icons";
import type { Work } from "../mock";
import WorkCard from "./work-card";

const TABS = [
    { id: "for-you", label: "为你推荐" },
    { id: "new", label: "最新" },
    { id: "week", label: "本周热门" },
    { id: "follow", label: "关注作者新作", badge: "+5" },
];

type WorkGridProps = {
    works: Work[];
    selected: Set<number>;
    onToggle: (id: number) => void;
};

function WorkGrid({ works, selected, onToggle }: WorkGridProps) {
    return (
        <section>
            <div className="mb-4 flex items-center border-muted/60 border-b">
                <Tabs defaultValue="for-you" className="flex-1">
                    <TabsList variant="line" className="h-12 gap-0">
                        {TABS.map((t) => (
                            <TabsTrigger
                                key={t.id}
                                value={t.id}
                                className="h-full px-4 text-sm data-active:text-primary data-active:after:h-[3px] data-active:after:bg-primary"
                            >
                                {t.label}
                                {t.badge && (
                                    <Badge variant="default" className="font-mono text-[10px]">
                                        {t.badge}
                                    </Badge>
                                )}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                <div className="flex items-center gap-1.5 pb-1.5">
                    <Button variant="ghost" size="sm">
                        推荐度 <HugeiconsIcon icon={ChevronDownIcon} size={14} strokeWidth={1.5} />
                    </Button>
                    <Button variant="ghost" size="sm">
                        24 小时 <HugeiconsIcon icon={ChevronDownIcon} size={14} strokeWidth={1.5} />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-5 gap-3">
                {works.map((w) => (
                    <WorkCard key={w.id} work={w} selected={selected.has(w.id)} onSelect={() => onToggle(w.id)} />
                ))}
            </div>
        </section>
    );
}

export default WorkGrid;
