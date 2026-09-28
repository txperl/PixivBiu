import { useEffect, useRef } from "react";

/**
 * Runs `effect` when `identity` changes after mount — not on mount, and not when a
 * kept-alive page is shown again (an <Activity> reveal re-runs every effect even
 * though nothing changed). Use it for reactions to a navigation, such as clearing a
 * list's selection when its identity changes; encode the identity as a string.
 */
export function useChangeEffect(identity: string, effect: () => void) {
    const previous = useRef(identity);
    const latestEffect = useRef(effect);
    latestEffect.current = effect;
    useEffect(() => {
        if (previous.current === identity) return;
        previous.current = identity;
        latestEffect.current();
    }, [identity]);
}
