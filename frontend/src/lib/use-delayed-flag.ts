import { useEffect, useState } from "react";

// Returns true only after `active` has stayed true continuously for `delayMs`,
// and flips back to false immediately when `active` clears. Gates a loading
// indicator so a fast (sub-threshold) fetch never paints a one-frame "Loading…"
// flash — NN/g response-time guidance treats <~100ms as instant, so a spinner
// that appears and vanishes inside that window reads as jank.
export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (!active) {
            setShown(false);
            return;
        }
        const id = setTimeout(() => setShown(true), delayMs);
        return () => clearTimeout(id);
    }, [active, delayMs]);
    return shown;
}
