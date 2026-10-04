import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { BookmarkDetail, Restrict } from "../src/features/illusts/api";
import {
    bookmarkEditorNavigationIdentity,
    bookmarkRevisionKey,
    bookmarkStatus,
    invalidateBookmarkMembership,
    normalizeBookmarkTags,
    registeredBookmarkTags,
    validBookmarkTags,
} from "../src/features/illusts/bookmark-state";
import { createBookmarkTagWriter } from "../src/features/illusts/bookmark-tag-writer";

const detail = (restrict: Restrict, names: string[]): BookmarkDetail => ({
    is_bookmarked: true,
    restrict,
    tags: names.map((name) => ({ name, is_registered: true })),
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

describe("immediate bookmark tag edits", () => {
    test("serializes writes and coalesces selections made while saving", async () => {
        const first = deferred<boolean>();
        const writes: string[][] = [];
        let active = 0;
        let maximum = 0;
        let displayed: string[] = [];
        let saving = false;
        const writer = createBookmarkTagWriter({
            initial: ["A"],
            save: async (tags) => {
                writes.push(tags);
                maximum = Math.max(maximum, ++active);
                const result = writes.length === 1 ? await first.promise : true;
                active--;
                return result;
            },
            onChange: (tags) => {
                displayed = tags;
            },
            onSaving: (value) => {
                saving = value;
            },
        });
        writer.change(["A", "B"]);
        await Promise.resolve();
        writer.change(["A", "B", "C"]);
        writer.change(["B", "C"]);
        expect(displayed).toEqual(["B", "C"]);
        expect(writes).toEqual([["A", "B"]]);
        expect(saving).toBe(true);
        first.resolve(true);
        await writer.settled();
        expect(writes).toEqual([
            ["A", "B"],
            ["B", "C"],
        ]);
        expect(maximum).toBe(1);
        expect(saving).toBe(false);
    });
    test("rolls back failed batches without automatically replaying queued edits", async () => {
        const first = deferred<boolean>();
        const writes: string[][] = [];
        let displayed: string[] = [];
        const writer = createBookmarkTagWriter({
            initial: ["A"],
            save: (tags) => {
                writes.push(tags);
                return writes.length === 1 ? first.promise : Promise.resolve(true);
            },
            onChange: (tags) => {
                displayed = tags;
            },
            onSaving: () => {},
        });
        writer.change(["A", "B"]);
        await Promise.resolve();
        writer.change(["A", "B", "C"]);
        first.resolve(false);
        await writer.settled();
        expect(writes).toEqual([["A", "B"]]);
        expect(displayed).toEqual(["A"]);
        writer.change(["A", "C"]);
        await writer.settled();
        expect(writes).toEqual([
            ["A", "B"],
            ["A", "C"],
        ]);
    });
    test("clears all tags when the final pending selection is empty", async () => {
        const first = deferred<boolean>();
        const writes: string[][] = [];
        const writer = createBookmarkTagWriter({
            initial: ["A"],
            save: (tags) => {
                writes.push(tags);
                return writes.length === 1 ? first.promise : Promise.resolve(true);
            },
            onChange: () => {},
            onSaving: () => {},
        });
        writer.change(["A", "B"]);
        await Promise.resolve();
        writer.change([]);
        first.resolve(true);
        await writer.settled();
        expect(writes).toEqual([["A", "B"], []]);
    });
    test("does not lose a change made immediately after an unchanged selection", async () => {
        const writes: string[][] = [];
        const writer = createBookmarkTagWriter({
            initial: ["A"],
            save: async (tags) => {
                writes.push(tags);
                return true;
            },
            onChange: () => {},
            onSaving: () => {},
        });
        writer.change(["A"]);
        writer.change(["A", "B"]);
        await writer.settled();
        expect(writes).toEqual([["A", "B"]]);
    });
    test("uses the empty confirmed selection after removal, including failed re-bookmarking", async () => {
        const writes: string[][] = [];
        let displayed = ["old tag"];
        const writer = createBookmarkTagWriter({
            initial: displayed,
            save: async (tags) => {
                writes.push(tags);
                return false;
            },
            onChange: (tags) => {
                displayed = tags;
            },
            onSaving: () => {},
        });
        expect(writer.synchronize([])).toBe(true);
        expect(displayed).toEqual([]);
        writer.change(["new tag"]);
        await writer.settled();
        expect(writes).toEqual([["new tag"]]);
        expect(displayed).toEqual([]);
    });
    test("cannot overwrite an accepted batch with a cache update", async () => {
        const pending = deferred<boolean>();
        let displayed = ["A"];
        const writer = createBookmarkTagWriter({
            initial: displayed,
            save: () => pending.promise,
            onChange: (tags) => {
                displayed = tags;
            },
            onSaving: () => {},
        });
        writer.change(["A", "B"]);
        expect(writer.pending).toBe(true);
        expect(writer.synchronize([])).toBe(false);
        expect(displayed).toEqual(["A", "B"]);
        pending.resolve(true);
        await writer.settled();
        expect(writer.pending).toBe(false);
        expect(writer.synchronize([])).toBe(true);
        expect(displayed).toEqual([]);
    });
    test("adopts idle cache updates as the next write and rollback baseline", async () => {
        const writes: string[][] = [];
        let displayed = ["old tag"];
        const writer = createBookmarkTagWriter({
            initial: displayed,
            save: async (tags) => {
                writes.push(tags);
                return false;
            },
            onChange: (tags) => {
                displayed = tags;
            },
            onSaving: () => {},
        });
        writer.synchronize(["updated elsewhere"]);
        expect(displayed).toEqual(["updated elsewhere"]);
        writer.change([...displayed, "new tag"]);
        await writer.settled();
        expect(writes).toEqual([["updated elsewhere", "new tag"]]);
        expect(displayed).toEqual(["updated elsewhere"]);
    });
});

describe("bookmark contracts", () => {
    test("uses only registered tags and distinguishes an unsaved work from public bookmarks", () => {
        const saved = detail("private", ["猫"]);
        saved.tags.push({ name: "suggestion", is_registered: false });
        expect(registeredBookmarkTags(saved)).toEqual(["猫"]);
        expect(bookmarkStatus(saved)).toBe("private");
        expect(bookmarkStatus(detail("public", []))).toBe("public");
        const unsaved = { ...saved, is_bookmarked: false };
        expect(registeredBookmarkTags(unsaved)).toEqual([]);
        expect(bookmarkStatus(unsaved)).toBe("none");
        expect(registeredBookmarkTags(undefined)).toEqual([]);
    });
    test("viewer edits stay open through first-page resets and equivalent URLs", () => {
        const before = bookmarkEditorNavigationIdentity(42, "/user/123", "?tab=bookmarks&tag=猫&page=3&illust=42");
        const reset = bookmarkEditorNavigationIdentity(42, "/user/123", "?tab=bookmarks&tag=猫&illust=42");
        const reordered = bookmarkEditorNavigationIdentity(42, "/user/123", "?illust=42&tag=猫&tab=bookmarks");
        expect(before).toBe(reset);
        expect(reset).toBe(reordered);
    });
    test("work, route, and filter changes still close editors; card pagination remains distinct", () => {
        const identity = (path: string, search: string) => bookmarkEditorNavigationIdentity(42, path, search);
        const viewer = identity("/user/123", "?tab=bookmarks&illust=42");
        expect(identity("/user/123", "?tab=bookmarks&illust=43")).not.toBe(viewer);
        expect(identity("/user/123", "?tab=bookmarks")).not.toBe(viewer);
        expect(identity("/search/猫", "?tab=bookmarks&illust=42")).not.toBe(viewer);
        expect(identity("/user/123", "?tab=bookmarks_private&illust=42")).not.toBe(viewer);
        expect(identity("/user/123", "?tab=bookmarks&tag=猫&illust=42")).not.toBe(viewer);
        expect(identity("/user/123", "?tab=bookmarks&page=2")).not.toBe(identity("/user/123", "?tab=bookmarks"));
        expect(identity("/user/123", "?tab=bookmarks&page=2&illust=43")).not.toBe(
            identity("/user/123", "?tab=bookmarks&illust=43"),
        );
    });
    test("normalization preserves spelling and rejects lossy input", () => {
        expect(normalizeBookmarkTags([" 猫 ", "猫", "", "Case", "case", "花&鳥/+ "])).toEqual([
            "猫",
            "Case",
            "case",
            "花&鳥/+",
        ]);
        expect(validBookmarkTags(["中 文"])).toBe(false);
        expect(validBookmarkTags(["中\u3000文"])).toBe(false);
        expect(validBookmarkTags(Array.from({ length: 11 }, (_, i) => String(i)))).toBe(false);
    });
    test("only changed memberships discard their cursor chain", () => {
        const client = new QueryClient();
        const keys = [
            bookmarkRevisionKey(123, "public", ""),
            bookmarkRevisionKey(123, "private", ""),
            bookmarkRevisionKey(123, "public", "A"),
            bookmarkRevisionKey(123, "private", "B"),
            bookmarkRevisionKey(123, "public", "B"),
            bookmarkRevisionKey(123, "private", "A"),
            bookmarkRevisionKey(456, "public", ""),
        ];
        for (const key of keys) client.setQueryData(key, 0);
        invalidateBookmarkMembership(client, 123, detail("public", ["A"]), detail("private", ["B"]));
        expect(keys.map((key) => client.getQueryData(key))).toEqual([1, 1, 1, 1, 0, 0, 0]);
        client.clear();
    });
    test("removing the last tag refreshes that category but keeps all-bookmarks pagination", () => {
        const client = new QueryClient();
        const all = bookmarkRevisionKey(123, "public", "");
        const selected = bookmarkRevisionKey(123, "public", "A");
        client.setQueryData(all, 0);
        client.setQueryData(selected, 0);
        invalidateBookmarkMembership(client, 123, detail("public", ["A"]), detail("public", []));
        expect(client.getQueryData(all)).toBe(0);
        expect(client.getQueryData(selected)).toBe(1);
        client.clear();
    });
});
