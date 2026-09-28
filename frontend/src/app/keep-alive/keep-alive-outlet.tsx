import {
    Activity,
    createContext,
    memo,
    type ReactNode,
    type RefObject,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { type Location, type RouteObject, useLocation, useRoutes } from "react-router";
import { type PageVisibility, PageVisibilityContext } from "@/lib/page-visibility";
import { QUERY_GC_TIME } from "@/lib/query/client";
import { APP_SCROLLER_SELECTOR } from "@/lib/scroll";
import { instanceKeyOf } from "./instance-key";
import { initialKeepAliveState, type KeepAliveOptions, nextKeepAliveState } from "./lru";

// Enough for every sidebar section plus a little Back/Forward history.
const KEEP_ALIVE_MAX = 8;
const KEEP_ALIVE_IDLE_TTL = QUERY_GC_TIME - 5 * 60_000;

type KeepAliveControl = {
    // Land the next navigation at the top instead of the target page's saved scroll.
    requestScrollReset: () => void;
};

type ControlState = KeepAliveControl & { consumeScrollReset: () => boolean };

const KeepAliveControlContext = createContext<ControlState | null>(null);

/** Shared by the sidebar (which requests resets) and KeepAliveOutlet (which applies them). */
export function KeepAliveControlProvider({ children }: { children: ReactNode }) {
    const pendingReset = useRef(false);
    const value = useMemo<ControlState>(
        () => ({
            requestScrollReset: () => {
                pendingReset.current = true;
            },
            consumeScrollReset: () => {
                const pending = pendingReset.current;
                pendingReset.current = false;
                return pending;
            },
        }),
        [],
    );
    return <KeepAliveControlContext value={value}>{children}</KeepAliveControlContext>;
}

export function useKeepAliveControl(): KeepAliveControl {
    const ctx = useContext(KeepAliveControlContext);
    if (!ctx) throw new Error("useKeepAliveControl must be used within KeepAliveControlProvider");
    return ctx;
}

// Renders the page table against the instance's own location: react-router wraps the
// result in a LocationContext, so a hidden page's useLocation/useSearchParams/useParams
// keep reading its own URL instead of whichever page is visible. Memoized so a hidden
// instance re-renders only for context changes, not on every navigation.
const KeepAliveInstance = memo(function KeepAliveInstance({
    id,
    routes,
    location,
    committedActiveId,
}: {
    id: string;
    routes: RouteObject[];
    location: Location;
    committedActiveId: RefObject<string | null>;
}) {
    const visibility = useMemo<PageVisibility>(
        () => ({ isHidden: () => committedActiveId.current !== id }),
        [id, committedActiveId],
    );
    return <PageVisibilityContext value={visibility}>{useRoutes(routes, location)}</PageVisibilityContext>;
});

// Redirect-only and fallback routes render outside the cache, so they never report as
// kept-alive pages.
function UncachedPage({ routes, location }: { routes: RouteObject[]; location: Location }) {
    return useRoutes(routes, location);
}

type KeepAliveOutletProps = {
    routes: RouteObject[];
    selfUserId: number | null | undefined;
};

/**
 * Drop-in for <Outlet/> that keeps visited pages mounted behind React's <Activity>.
 * A hidden page keeps its state and DOM but has its effects torn down (observers,
 * subscriptions, filter-panel registrations) and recreated when shown again, so
 * mount-time work in pages must be idempotent. Scroll of the shared app scroller is
 * saved per instance and restored on return; new instances start at the top.
 *
 * Key the outlet by account so a session switch drops every kept page.
 */
export function KeepAliveOutlet({ routes, selfUserId }: KeepAliveOutletProps) {
    const location = useLocation();
    const control = useContext(KeepAliveControlContext);
    const [state, setState] = useState(() =>
        initialKeepAliveState(location, instanceKeyOf(routes, location, selfUserId)),
    );

    // Advance on navigation with the render-time state update pattern: React re-renders
    // immediately with the new state before committing, and an interrupted render
    // leaves nothing behind (unlike mutating a ref here).
    if (state.location !== location) {
        const options: KeepAliveOptions = { max: KEEP_ALIVE_MAX, idleTtl: KEEP_ALIVE_IDLE_TTL };
        const key = instanceKeyOf(routes, location, selfUserId);
        setState(nextKeepAliveState(state, location, key, Date.now(), options));
    }

    const activeId = state.entries.find((e) => e.key === state.activeKey)?.id ?? null;

    const rootRef = useRef<HTMLDivElement>(null);
    const positions = useRef(new Map<string, number>());
    // The instance the scroller's position currently belongs to.
    const trackedId = useRef<string | null>(null);
    // The visible instance as of the last commit (backs PageVisibility.isHidden).
    const committedActiveId = useRef<string | null>(activeId);

    const getScroller = useCallback(() => rootRef.current?.closest<HTMLElement>(APP_SCROLLER_SELECTOR) ?? null, []);

    useEffect(() => {
        const scroller = getScroller();
        if (!scroller) return;
        const onScroll = () => {
            if (trackedId.current != null) positions.current.set(trackedId.current, scroller.scrollTop);
        };
        scroller.addEventListener("scroll", onScroll, { passive: true });
        return () => scroller.removeEventListener("scroll", onScroll);
    }, [getScroller]);

    // Runs after <Activity> has shown/hidden the instances, so the revealed page is laid
    // out and its saved offset is reachable. Same-instance navigations (filters, page)
    // leave scroll to the page itself (pagers scroll to top on their own).
    // biome-ignore lint/correctness/useExhaustiveDependencies: re-run per navigation to honor scroll-reset requests.
    useLayoutEffect(() => {
        committedActiveId.current = activeId;
        const scroller = getScroller();
        if (!scroller) return;

        const live = new Set(state.entries.map((e) => e.id));
        for (const id of positions.current.keys()) if (!live.has(id)) positions.current.delete(id);

        const reset = control?.consumeScrollReset() ?? false;
        if (!reset && trackedId.current === activeId && activeId != null) return;

        trackedId.current = activeId;
        const top = reset || activeId == null ? 0 : (positions.current.get(activeId) ?? 0);
        scroller.scrollTop = top;
        if (activeId != null) positions.current.set(activeId, top);
    }, [activeId, state.location, state.entries, control, getScroller]);

    return (
        <div ref={rootRef} className="contents">
            {state.entries.map((e) => (
                <Activity key={e.id} mode={e.key === state.activeKey ? "visible" : "hidden"}>
                    <KeepAliveInstance
                        id={e.id}
                        routes={routes}
                        location={e.location}
                        committedActiveId={committedActiveId}
                    />
                </Activity>
            ))}
            {state.activeKey == null && <UncachedPage routes={routes} location={state.location} />}
        </div>
    );
}
