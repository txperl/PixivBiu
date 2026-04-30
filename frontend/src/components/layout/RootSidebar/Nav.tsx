import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
    BookmarkIcon,
    DownloadIcon,
    FollowIcon,
    HomeIcon,
    ImageIcon,
    RankIcon,
    SearchIcon,
    SettingsIcon,
} from "@/lib/icons";
import { cn } from "@/lib/utils";

type NavItemDef = {
    id: string;
    label: string;
    icon: IconSvgElement;
    count?: number;
    badge?: number;
};

type NavGroupDef = {
    label: string;
    items: NavItemDef[];
};

const NAV_GROUPS: NavGroupDef[] = [
    {
        label: "浏览",
        items: [
            { id: "home", label: "首页", icon: HomeIcon },
            { id: "search", label: "搜索", icon: SearchIcon },
            { id: "rank", label: "排行榜", icon: RankIcon },
        ],
    },
    {
        label: "个人",
        items: [
            { id: "follow", label: "关注的作者", icon: FollowIcon, count: 12 },
            { id: "bookmark", label: "收藏", icon: BookmarkIcon, count: 284 },
            { id: "self", label: "我的作品", icon: ImageIcon, count: 8 },
        ],
    },
    {
        label: "工具",
        items: [
            { id: "dl", label: "下载管理", icon: DownloadIcon, badge: 2 },
            { id: "settings", label: "设置", icon: SettingsIcon },
        ],
    },
];

type NavItemProps = {
    item: NavItemDef;
    active: boolean;
    onClick: () => void;
};

function NavItem({ item, active, onClick }: NavItemProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "flex h-10 w-full cursor-pointer items-center gap-3 rounded-full px-4 text-left text-sm transition-colors",
                active
                    ? "bg-secondary font-semibold text-secondary-foreground"
                    : "font-medium text-muted-foreground hover:bg-sidebar-accent",
            )}
        >
            <HugeiconsIcon icon={item.icon} size={18} strokeWidth={active ? 2 : 1.5} />
            <span className="flex-1">{item.label}</span>
            {item.badge !== undefined && <Badge variant="destructive">{item.badge}</Badge>}
            {item.count !== undefined && (
                <span className="font-mono text-[11px] text-muted-foreground">{item.count}</span>
            )}
        </button>
    );
}

function Nav() {
    const [activeId, setActiveId] = useState("home");

    return (
        <nav className="flex flex-col gap-4">
            {NAV_GROUPS.map((g) => (
                <div key={g.label}>
                    <div className="px-4 pb-2 font-medium text-[11px] text-muted-foreground tracking-wider">
                        {g.label}
                    </div>
                    <div className="flex flex-col gap-1">
                        {g.items.map((item) => (
                            <NavItem
                                key={item.id}
                                item={item}
                                active={activeId === item.id}
                                onClick={() => setActiveId(item.id)}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </nav>
    );
}

export default Nav;
