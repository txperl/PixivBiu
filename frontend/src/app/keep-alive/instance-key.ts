import { matchRoutes, type RouteObject } from "react-router";
import { normalizePathname, sectionOf } from "@/app/sections";

export type KeepAliveHandle = { keepAlive?: false };

type Loc = { pathname: string; search: string };

/**
 * Identity of the kept-alive page instance a location renders into, or null when the
 * location must render uncached (redirect-only and fallback routes opt out through
 * `handle.keepAlive: false`).
 *
 * Pages are keyed by pathname, so search params (filters, page, `?illust`) update the
 * instance in place while distinct paths (`/search/a` vs `/search/b`, other users) get
 * their own. The signed-in user's page additionally splits by sidebar section so
 * bookmarks / following / works each keep their own state.
 */
export function instanceKeyOf(routes: RouteObject[], loc: Loc, selfId: number | null | undefined): string | null {
    const matches = matchRoutes(routes, loc.pathname);
    if (!matches) return null;
    if (matches.some((m) => (m.route.handle as KeepAliveHandle | undefined)?.keepAlive === false)) return null;

    const path = normalizePathname(loc.pathname);
    const section = sectionOf(loc, selfId);
    if (section === "bookmark" || section === "follow" || section === "self") return `${path}#${section}`;
    return path;
}
