import { useCallback, useEffect, useRef, useState } from "react";

const HISTORY_KEY = "pixivbiu.search.history.v1";
const HISTORY_LIMIT = 8;

// `storage` event fires cross-tab only, so we maintain a same-tab registry.
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function notify(key: string) {
    const set = listeners.get(key);
    if (!set) return;
    for (const l of set) l();
}

function subscribe(key: string, l: Listener): () => void {
    let set = listeners.get(key);
    if (!set) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(l);
    return () => {
        set.delete(l);
        if (set.size === 0) listeners.delete(key);
    };
}

function safeRead(key: string): string[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
    } catch {
        return [];
    }
}

function shallowEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function safeWrite(key: string, value: readonly string[]) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Quota exceeded / privacy mode — silently no-op.
    }
}

type Updater = (current: readonly string[]) => readonly string[];

// Updater API: callbacks read from a ref, so their identity stays stable across
// renders and consumers can pass them to useEffect deps without thrashing.
function useStringListStore(key: string): readonly [readonly string[], (updater: Updater) => void] {
    const [value, setValue] = useState<readonly string[]>(() => safeRead(key));
    const ref = useRef(value);
    ref.current = value;

    useEffect(() => {
        const sync = () => {
            const next = safeRead(key);
            if (shallowEqual(next, ref.current)) return;
            ref.current = next;
            setValue(next);
        };
        const unsubscribe = subscribe(key, sync);
        const onStorage = (e: StorageEvent) => {
            if (e.key === key) sync();
        };
        window.addEventListener("storage", onStorage);
        return () => {
            unsubscribe();
            window.removeEventListener("storage", onStorage);
        };
    }, [key]);

    const update = useCallback(
        (updater: Updater) => {
            const next = updater(ref.current);
            if (next === ref.current) return;
            ref.current = next;
            safeWrite(key, next);
            setValue(next);
            notify(key);
        },
        [key],
    );

    return [value, update] as const;
}

export type SearchHistoryApi = {
    items: readonly string[];
    push: (keyword: string) => void;
    remove: (keyword: string) => void;
    clear: () => void;
};

export function useSearchHistory(): SearchHistoryApi {
    const [items, update] = useStringListStore(HISTORY_KEY);

    const push = useCallback(
        (raw: string) => {
            const k = raw.trim();
            if (!k) return;
            update((cur) => {
                if (cur[0] === k) return cur;
                const without = cur.filter((x) => x !== k);
                return [k, ...without].slice(0, HISTORY_LIMIT);
            });
        },
        [update],
    );

    const remove = useCallback(
        (k: string) => {
            update((cur) => {
                const next = cur.filter((x) => x !== k);
                return next.length === cur.length ? cur : next;
            });
        },
        [update],
    );

    const clear = useCallback(() => {
        update((cur) => (cur.length === 0 ? cur : []));
    }, [update]);

    return { items, push, remove, clear };
}
