import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { NavLink, useLocation, useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth";
import { useDownloadCounts } from "@/features/downloads";
import { useMessages } from "@/i18n";
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
    id: string;
    label: string;
    items: NavItemDef[];
};

function ItemBody({ item, active }: { item: NavItemDef; active: boolean }) {
    return (
        <>
            <HugeiconsIcon icon={item.icon} size={18} strokeWidth={active ? 1.5 : 1.5} />
            <span className="flex-1">{item.label}</span>
            {item.badge !== undefined && <Badge variant="destructive">{item.badge}</Badge>}
            {item.count !== undefined && (
                <span className="font-mono text-[11px] text-muted-foreground">{item.count}</span>
            )}
        </>
    );
}

const baseClass =
    "flex h-10 w-full cursor-pointer items-center gap-3 rounded-xl px-4 text-left text-sm transition-colors";
const activeClass = "bg-secondary text-secondary-foreground";
const inactiveClass = "text-muted-foreground hover:bg-sidebar-accent";
const disabledClass = "text-muted-foreground/60 cursor-not-allowed";

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
    const m = useMessages();
    const { status } = useAuth();
    const { activeCount } = useDownloadCounts();
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

    const browseGroup: NavGroupDef = {
        id: "browse",
        label: m.nav_group_browse(),
        items: [
            { id: "home", label: m.nav_home(), icon: HomeIcon, to: "/" },
            { id: "search", label: m.nav_search(), icon: SearchIcon, to: "/search" },
            { id: "rank", label: m.nav_ranking(), icon: RankIcon, to: "/ranking" },
        ],
    };

    const settingsItem: NavItemDef = { id: "settings", label: m.nav_settings(), icon: SettingsIcon, to: "/settings" };

    const personalItems: NavItemDef[] = [
        {
            id: "bookmark",
            label: m.nav_bookmarks(),
            icon: HeartIcon,
            to: isLoggedIn ? "/me/bookmarks" : undefined,
            activeMatch: matchMyUserTab(["bookmarks"]),
        },
        {
            id: "follow",
            label: m.nav_following(),
            icon: FollowIcon,
            to: isLoggedIn ? "/me/following" : undefined,
            activeMatch: matchMyUserTab(["following"]),
        },
        {
            id: "self",
            label: m.nav_my_works(),
            icon: ImageIcon,
            to: isLoggedIn ? "/me" : undefined,
            activeMatch: matchMyUserTab(["illust", "manga"]),
        },
    ];

    const downloadsItem: NavItemDef = {
        id: "dl",
        label: m.nav_downloads(),
        icon: DownloadIcon,
        to: "/downloads",
        badge: activeCount > 0 ? activeCount : undefined,
    };

    const groups: NavGroupDef[] = [
        browseGroup,
        { id: "personal", label: m.nav_group_personal(), items: personalItems },
        { id: "tools", label: m.nav_group_tools(), items: [downloadsItem, settingsItem] },
    ];

    return (
        <nav className="flex flex-col gap-4">
            {groups.map((g) => (
                <div key={g.id}>
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
