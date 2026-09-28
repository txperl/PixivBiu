import { type RefObject, useContext, useLayoutEffect, useRef } from "react";
import { PageVisibilityContext } from "@/lib/page-visibility";

type Closable = { close: () => void; unmount: () => void };

/**
 * Actions ref for a Base UI popup root that closes the popup when its kept-alive page
 * is hidden. <Activity> hides the page's DOM but not its portals, so an open tooltip/
 * popover/menu/dialog would otherwise stay floating over the next page with its
 * dismiss listeners torn down.
 *
 * Hiding runs layout-effect cleanups, but so do StrictMode's simulated remount and a
 * real unmount; the cleanup therefore defers to a microtask (after the commit) and acts
 * only if the effect was not re-run and the page is actually hidden. The popup is also
 * unmounted right away — Base UI normally does that after the exit animation, from
 * effects a hidden tree no longer runs. React detaches the root's imperative handle (a
 * child) before this cleanup, so the last handle is captured after every commit.
 * Pass through the caller's own `actionsRef` so it keeps working.
 */
export function useCloseOnHide<A extends Closable>(external?: RefObject<A | null>): RefObject<A | null> {
    const page = useContext(PageVisibilityContext);
    const internal = useRef<A | null>(null);
    const actionsRef = external ?? internal;
    const lastActions = useRef<A | null>(null);
    const mounts = useRef(0);

    useLayoutEffect(() => {
        if (actionsRef.current) lastActions.current = actionsRef.current;
    });

    useLayoutEffect(() => {
        if (!page) return;
        const mount = ++mounts.current;
        return () => {
            queueMicrotask(() => {
                if (mounts.current !== mount || !page.isHidden()) return;
                const actions = lastActions.current;
                actions?.close();
                actions?.unmount();
            });
        };
    }, [page]);

    return actionsRef;
}
