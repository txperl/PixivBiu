import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth";
import type { InboxEvent } from "./types";

// EventSource lifecycle is tied to the auth session: /api/v1/events is auth-gated
// (401 otherwise), and after logout the previous user's events must stop. We open
// the connection only while authenticated and tear it down on transition out;
// subscriber Sets persist across the cycle so consumers don't need to re-subscribe.

type Listener = (e: InboxEvent) => void;

interface EventStreamContextValue {
    subscribe: (topic: string, listener: Listener) => () => void;
    // True while EventSource is open. Consumers can trigger an authoritative
    // refresh on each true transition to close the gap between their initial
    // snapshot and the moment the stream actually starts delivering events.
    connected: boolean;
}

const KNOWN_EVENTS = [
    "download.job.queued",
    "download.job.started",
    "download.job.completed",
    "download.job.failed",
    "download.job.cancelled",
    "download.job.deleted",
    "download.task.started",
    "download.task.progress",
    "download.task.completed",
    "download.task.failed",
    "download.task.cancelled",
    "system.resync",
] as const;

const EventStreamContext = createContext<EventStreamContextValue | null>(null);

export function EventStreamProvider({ children }: { children: ReactNode }) {
    const { status } = useAuth();
    const authenticated = !!status?.authenticated;
    const listenersRef = useRef<Map<string, Set<Listener>>>(new Map());
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        if (!authenticated) {
            setConnected(false);
            return;
        }

        const es = new EventSource("/api/v1/events?topics=download");
        es.onopen = () => setConnected(true);
        const handlers: { name: string; fn: (ev: MessageEvent) => void }[] = [];
        for (const name of KNOWN_EVENTS) {
            const fn = (ev: MessageEvent) => {
                let payload: InboxEvent;
                try {
                    payload = JSON.parse(ev.data) as InboxEvent;
                } catch {
                    return;
                }
                const set = listenersRef.current.get(payload.topic);
                if (!set) return;
                for (const l of set) l(payload);
            };
            es.addEventListener(name, fn);
            handlers.push({ name, fn });
        }

        return () => {
            setConnected(false);
            for (const { name, fn } of handlers) es.removeEventListener(name, fn);
            es.close();
        };
    }, [authenticated]);

    const subscribe = useMemo<EventStreamContextValue["subscribe"]>(
        () => (topic, listener) => {
            const map = listenersRef.current;
            let set = map.get(topic);
            if (!set) {
                set = new Set();
                map.set(topic, set);
            }
            set.add(listener);
            return () => {
                const cur = listenersRef.current.get(topic);
                if (!cur) return;
                cur.delete(listener);
                if (cur.size === 0) listenersRef.current.delete(topic);
            };
        },
        [],
    );

    const value = useMemo<EventStreamContextValue>(() => ({ subscribe, connected }), [subscribe, connected]);

    return <EventStreamContext.Provider value={value}>{children}</EventStreamContext.Provider>;
}

export function useEventStream() {
    const ctx = useContext(EventStreamContext);
    if (!ctx) throw new Error("useEventStream must be used inside <EventStreamProvider>");
    return ctx;
}
