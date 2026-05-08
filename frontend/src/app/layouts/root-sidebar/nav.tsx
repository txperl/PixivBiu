import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { NavLink } from "react-router";
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
    to?: string;
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
            { id: "home", label: "首页", icon: HomeIcon, to: "/" },
            { id: "search", label: "搜索", icon: SearchIcon, to: "/search" },
            { id: "rank", label: "排行榜", icon: RankIcon, to: "/ranking" },
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

function ItemBody({ item, active }: { item: NavItemDef; active: boolean }) {
    return (
        <>
            <HugeiconsIcon icon={item.icon} size={18} strokeWidth={active ? 2 : 1.5} />
            <span className="flex-1">{item.label}</span>
            {item.badge !== undefined && <Badge variant="destructive">{item.badge}</Badge>}
            {item.count !== undefined && (
                <span className="font-mono text-[11px] text-muted-foreground">{item.count}</span>
            )}
        </>
    );
}

const baseClass =
    "flex h-10 w-full cursor-pointer items-center gap-3 rounded-full px-4 text-left text-sm transition-colors";
const activeClass = "bg-secondary font-semibold text-secondary-foreground";
const inactiveClass = "font-medium text-muted-foreground hover:bg-sidebar-accent";
const disabledClass = "font-medium text-muted-foreground/60 cursor-not-allowed";

function NavItem({ item }: { item: NavItemDef }) {
    if (!item.to) {
        return (
            <button type="button" disabled className={cn(baseClass, disabledClass)} aria-disabled="true">
                <ItemBody item={item} active={false} />
            </button>
        );
    }
    return (
        <NavLink
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => cn(baseClass, isActive ? activeClass : inactiveClass)}
        >
            {({ isActive }) => <ItemBody item={item} active={isActive} />}
        </NavLink>
    );
}

function Nav() {
    return (
        <nav className="flex flex-col gap-4">
            {NAV_GROUPS.map((g) => (
                <div key={g.label}>
                    <div className="px-4 pb-2 font-medium text-[11px] text-muted-foreground tracking-wider">
                        {g.label}
                    </div>
                    <div className="flex flex-col gap-1">
                        {g.items.map((item) => (
                            <NavItem key={item.id} item={item} />
                        ))}
                    </div>
                </div>
            ))}
        </nav>
    );
}

export default Nav;
