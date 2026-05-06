import { createContext, type ReactNode, useContext } from "react";
import type { InboxEvent } from "./types";

// TODO: real implementation. Wraps a single EventSource against /api/v1/events with
// ?topics=<csv>, replays Last-Event-ID on reconnect, fans out to subscribers.
// Until then this is a no-op so consumers can compile.

type Listener = (e: InboxEvent) => void;

interface EventStreamContextValue {
    subscribe: (topic: string, listener: Listener) => () => void;
}

const EventStreamContext = createContext<EventStreamContextValue | null>(null);

export function EventStreamProvider({ children }: { children: ReactNode }) {
    const value: EventStreamContextValue = {
        subscribe: () => () => {},
    };
    return <EventStreamContext.Provider value={value}>{children}</EventStreamContext.Provider>;
}

export function useEventStream() {
    const ctx = useContext(EventStreamContext);
    if (!ctx) throw new Error("useEventStream must be used inside <EventStreamProvider>");
    return ctx;
}
