import { type Dispatch, type SetStateAction, useRef, useState } from "react";

// Local state seeded from `prop` that re-adopts `prop` whenever it changes — except while
// `locked`, where the local (optimistic) value must win over a possibly-stale concurrent
// update. A drop-in replacement for `useState(prop)` when the prop is the server's truth but
// the component also toggles it optimistically (e.g. a bookmark/follow button): without the
// resync the control stays stuck at its mount-time value after the backing TanStack Query data
// revalidates and updates the prop. Uses React's documented "adjust state during render"
// pattern (https://react.dev/learn/you-might-not-need-an-effect) rather than an effect.
export function usePropSyncedState<T>(prop: T, locked: boolean): [T, Dispatch<SetStateAction<T>>] {
    const [value, setValue] = useState(prop);
    const last = useRef(prop);
    // Only reconcile while unlocked, and advance `last` only when we actually adopt. A prop
    // change that lands mid-lock (e.g. a list refetch completing during a pending toggle) is
    // deliberately left unobserved — `last` still holds the pre-lock value — so the very first
    // render after the lock clears sees `last !== prop` and adopts it. Advancing `last` during
    // the lock would "consume" that change and strand the control at its stale value.
    if (!locked && last.current !== prop) {
        last.current = prop;
        setValue(prop);
    }
    return [value, setValue];
}
