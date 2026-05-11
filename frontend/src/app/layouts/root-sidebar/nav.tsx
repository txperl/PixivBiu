import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { NavLink, useLocation, useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth";
import { useDownloads } from "@/features/downloads";
import {
    DownloadIcon,
    FollowIcon,
    HeartIcon,
    HomeIcon,
    ImageIcon,
    RankIcon,
    SearchIcon,
    SettingsIcon,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { readTab, type Tab } from "@/pages/user/tabs";

type ActiveMatch = (pathname: string, search: URLSearchParams) => boolean;

type NavItemDef = {
    id: string;
    label: string;
    icon: IconSvgElement;
    to?: string;
    count?: number;
    badge?: number;
    activeMatch?: ActiveMatch;
};

type NavGroupDef = {
    label: string;
    items: NavItemDef[];
};

const BROWSE_GROUP: NavGroupDef = {
    label: "浏览",
    items: [
        { id: "home", label: "首页", icon: HomeIcon, to: "/" },
        { id: "search", label: "搜索", icon: SearchIcon, to: "/search" },
        { id: "rank", label: "排行榜", icon: RankIcon, to: "/ranking" },
    ],
};

const SETTINGS_ITEM: NavItemDef = { id: "settings", label: "设置", icon: SettingsIcon };

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

function NavItem({ item, pathname, search }: { item: NavItemDef; pathname: string; search: URLSearchParams }) {
    if (!item.to) {
        return (
            <button type="button" disabled className={cn(baseClass, disabledClass)} aria-disabled="true">
                <ItemBody item={item} active={false} />
            </button>
        );
    }

    const externallyActive = item.activeMatch ? item.activeMatch(pathname, search) : false;

    return (
        <NavLink
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => cn(baseClass, isActive || externallyActive ? activeClass : inactiveClass)}
        >
            {({ isActive }) => <ItemBody item={item} active={isActive || externallyActive} />}
        </NavLink>
    );
}

function Nav() {
    const { status } = useAuth();
    const { activeCount } = useDownloads();
    const { pathname } = useLocation();
    const [search] = useSearchParams();

    const isLoggedIn = !!status?.authenticated && !!status.user_id;
    const myUserPath = isLoggedIn ? `/user/${status.user_id}` : null;

    const matchMyUserTab =
        (tabs: Tab[]): ActiveMatch =>
        (path, sp) => {
            if (!myUserPath || path !== myUserPath) return false;
            return tabs.includes(readTab(sp));
        };

    const personalItems: NavItemDef[] = [
        {
            id: "bookmark",
            label: "收藏",
            icon: HeartIcon,
            to: isLoggedIn ? "/me/bookmarks" : undefined,
            activeMatch: matchMyUserTab(["bookmarks"]),
        },
        {
            id: "follow",
            label: "关注的作者",
            icon: FollowIcon,
            to: isLoggedIn ? "/me/following" : undefined,
            activeMatch: matchMyUserTab(["following"]),
        },
        {
            id: "self",
            label: "我的作品",
            icon: ImageIcon,
            to: isLoggedIn ? "/me" : undefined,
            activeMatch: matchMyUserTab(["illust", "manga"]),
        },
    ];

    const downloadsItem: NavItemDef = {
        id: "dl",
        label: "下载管理",
        icon: DownloadIcon,
        to: "/downloads",
        badge: activeCount > 0 ? activeCount : undefined,
    };

    const groups: NavGroupDef[] = [
        BROWSE_GROUP,
        { label: "个人", items: personalItems },
        { label: "工具", items: [downloadsItem, SETTINGS_ITEM] },
    ];

    return (
        <nav className="flex flex-col gap-4">
            {groups.map((g) => (
                <div key={g.label}>
                    <div className="px-4 pb-2 font-medium text-[11px] text-muted-foreground tracking-wider">
                        {g.label}
                    </div>
                    <div className="flex flex-col gap-1">
                        {g.items.map((item) => (
                            <NavItem key={item.id} item={item} pathname={pathname} search={search} />
                        ))}
                    </div>
                </div>
            ))}
        </nav>
    );
}

export default Nav;
