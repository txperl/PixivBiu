import { useEffect, useRef } from "react";
import { useEventStream } from "./event-stream-provider";
import type { InboxEvent } from "./types";

// Fires `refresh` on an actual disconnected→connected transition and on
// `system.resync`. The ref pattern decouples the effect from `refresh`
// identity, so a closure-bound refresh changing on every filter/page
// render doesn't re-trigger fetches.
export function useRefreshOnReconnect(refresh: () => void) {
    const { subscribe, connected } = useEventStream();
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;

    const wasConnectedRef = useRef(connected);
    useEffect(() => {
        const was = wasConnectedRef.current;
        wasConnectedRef.current = connected;
        if (!was && connected) refreshRef.current();
    }, [connected]);

    useEffect(() => {
        const off = subscribe("system", (ev: InboxEvent) => {
            if (ev.type === "resync") refreshRef.current();
        });
        return off;
    }, [subscribe]);
}
