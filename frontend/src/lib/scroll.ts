/**
 * The app's page scroll container is the base-ui ScrollArea viewport tagged in
 * `app/layouts/root-layout.tsx` — NOT `<main>`. Anything that drives the page
 * scroll (scroll-to-top, scroll-spy, IntersectionObserver root) resolves it
 * through this selector so the contract lives in one place.
 */
export const APP_SCROLLER_SELECTOR = "[data-app-scroller]";

/** Smooth-scroll the app's page scroller back to the top (e.g. on pagination). */
export function scrollAppToTop() {
    document.querySelector<HTMLElement>(APP_SCROLLER_SELECTOR)?.scrollTo({ top: 0, behavior: "smooth" });
}
