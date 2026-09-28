import type { Location } from "react-router";

/**
 * Pure bookkeeping for kept-alive page instances (no React). Each navigation advances
 * the state: the target instance becomes active (created, reused, or recreated when it
 * idled too long), the previous one is stamped hidden, and the least recently shown
 * hidden instances are evicted beyond `max`.
 *
 * Entries keep insertion order so their React siblings never move in the DOM; `id`
 * doubles as the React key, and a new id means a fresh mount.
 */
export type KeepAliveEntry = {
    id: string;
    key: string;
    location: Location;
    // When the entry was last hidden; null while it is the active one.
    hiddenAt: number | null;
};

export type KeepAliveState = {
    entries: KeepAliveEntry[];
    activeKey: string | null;
    location: Location;
    nextSeq: number;
};

export type KeepAliveOptions = {
    max: number;
    // A page hidden longer than this is dropped and remounted fresh on return. Keep it
    // below the Query gcTime so a returning page never finds its data half-collected.
    idleTtl: number;
};

export function initialKeepAliveState(location: Location, key: string | null): KeepAliveState {
    const entries = key == null ? [] : [{ id: `${key}@0`, key, location, hiddenAt: null }];
    return { entries, activeKey: key, location, nextSeq: 1 };
}

export function nextKeepAliveState(
    state: KeepAliveState,
    location: Location,
    key: string | null,
    now: number,
    { max, idleTtl }: KeepAliveOptions,
): KeepAliveState {
    let { nextSeq } = state;

    let entries = state.entries
        .map((e) => (e.key === state.activeKey && e.key !== key ? { ...e, hiddenAt: now } : e))
        .filter((e) => e.hiddenAt == null || now - e.hiddenAt <= idleTtl);

    if (key != null) {
        const existing = entries.find((e) => e.key === key);
        if (existing) {
            entries = entries.map((e) => (e === existing ? { ...e, location, hiddenAt: null } : e));
        } else {
            entries = [...entries, { id: `${key}@${nextSeq}`, key, location, hiddenAt: null }];
            nextSeq += 1;
        }
    }

    while (entries.length > max) {
        let oldest: KeepAliveEntry | null = null;
        for (const e of entries) {
            if (e.hiddenAt != null && (oldest?.hiddenAt == null || e.hiddenAt < oldest.hiddenAt)) oldest = e;
        }
        if (!oldest) break;
        const evict = oldest;
        entries = entries.filter((e) => e !== evict);
    }

    return { entries, activeKey: key, location, nextSeq };
}
