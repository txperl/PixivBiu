import { createContext } from "react";

/**
 * Lets code inside a kept-alive page ask whether that page is currently hidden (see
 * app/keep-alive). Null outside kept-alive pages (layout-level UI such as the viewer).
 * `isHidden` reads committed state, so it is reliable after a commit — e.g. from a
 * microtask queued in an effect cleanup — not during render.
 */
export type PageVisibility = { isHidden: () => boolean };

export const PageVisibilityContext = createContext<PageVisibility | null>(null);
