import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useKeepAliveControl } from "@/app/keep-alive/keep-alive-outlet";
import { useSectionUrl } from "@/app/layouts/section-memory";
import { isAtSectionRoot, type SectionId, sectionDefaultUrl, sectionOf } from "@/app/sections";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/features/auth";
import { useDownloadCounts } from "@/features/downloads";
import { useUpdate } from "@/features/system";
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
import { useRefreshPage } from "@/lib/page-refresh";
import { isAppScrolledToTop, scrollAppToTop } from "@/lib/scroll";
import { cn } from "@/lib/utils";

type NavItemDef = {
    id: SectionId;
    label: string;
    icon: IconSvgElement;
    count?: number;
    badge?: number;
    // A small status dot (e.g. "update available"), shown when no numeric badge.
    dot?: boolean;
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
            {item.badge === undefined && item.dot && (
                <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
            )}
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

type NavItemProps = {
    item: NavItemDef;
    active: boolean;
    selfUserId: number | null | undefined;
};

// Links to the section's last visited URL. Clicking the active item steps back toward a
// fresh view, one level per click: to the section's landing view, then to its top, then
// refreshes it (the page's own refresh, if it registered one). Handled here rather than
// by navigating to the same URL, which would push a duplicate history entry.
function NavItem({ item, active, selfUserId }: NavItemProps) {
    const to = useSectionUrl(item.id, selfUserId);
    const location = useLocation();
    const navigate = useNavigate();
    const { requestScrollReset } = useKeepAliveControl();
    const refreshPage = useRefreshPage();

    if (!to) {
        return (
            <button type="button" disabled className={cn(baseClass, disabledClass)} aria-disabled="true">
                <ItemBody item={item} active={false} />
            </button>
        );
    }

    const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
        if (!active || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        if (isAtSectionRoot(item.id, location, selfUserId)) {
            if (isAppScrolledToTop()) refreshPage();
            else scrollAppToTop();
            return;
        }
        const landing = sectionDefaultUrl(item.id, selfUserId);
        if (!landing) return;
        requestScrollReset();
        navigate(landing);
    };

    return (
        <Link
            to={to}
            onClick={handleClick}
            aria-current={active ? "page" : undefined}
            className={cn(baseClass, active ? activeClass : inactiveClass)}
        >
            <ItemBody item={item} active={active} />
        </Link>
    );
}

function Nav() {
    const m = useMessages();
    const { status } = useAuth();
    const { activeCount } = useDownloadCounts();
    const { updateAvailable } = useUpdate();
    const location = useLocation();

    const selfUserId = status?.authenticated ? status.user_id : null;
    const activeSection = sectionOf(location, selfUserId);

    const browseGroup: NavGroupDef = {
        id: "browse",
        label: m.nav_group_browse(),
        items: [
            { id: "home", label: m.nav_home(), icon: HomeIcon },
            { id: "search", label: m.nav_search(), icon: SearchIcon },
            { id: "rank", label: m.nav_ranking(), icon: RankIcon },
        ],
    };

    const settingsItem: NavItemDef = {
        id: "settings",
        label: m.nav_settings(),
        icon: SettingsIcon,
        dot: updateAvailable,
    };

    const personalItems: NavItemDef[] = [
        {
            id: "bookmark",
            label: m.nav_bookmarks(),
            icon: HeartIcon,
        },
        {
            id: "follow",
            label: m.nav_following(),
            icon: FollowIcon,
        },
        {
            id: "self",
            label: m.nav_my_works(),
            icon: ImageIcon,
        },
    ];

    const downloadsItem: NavItemDef = {
        id: "dl",
        label: m.nav_downloads(),
        icon: DownloadIcon,
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
                            <NavItem
                                key={item.id}
                                item={item}
                                active={item.id === activeSection}
                                selfUserId={selfUserId}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </nav>
    );
}

export default Nav;
