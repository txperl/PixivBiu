// Wire format mirrors backend internal/inbox: { id, ts, topic, type, data }.
// Topic strings are open-ended on the wire; backend convention is "<topic>.<type>"
// in the SSE `event:` line, while the JSON payload carries them as separate fields.

export type EventTopic = "download" | "auth" | "system";

export interface InboxEvent<T = unknown> {
    id: string;
    ts: string;
    topic: EventTopic | string;
    type: string;
    data: T;
}
