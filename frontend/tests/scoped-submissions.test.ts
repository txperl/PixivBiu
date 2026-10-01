import { expect, test } from "bun:test";
import { ScopedSubmissions } from "../src/features/downloads/scoped-submissions";

test("same session and artwork share one in-flight request", async () => {
    const submissions = new ScopedSubmissions<number>();
    submissions.setScope("account:a");
    let called = 0;
    const accepted: number[] = [];
    const request = async () => {
        called++;
        return 42;
    };
    const first = submissions.run(1, request, (value) => accepted.push(value));
    const second = submissions.run(1, request, () => {
        throw new Error("duplicate adoption");
    });
    expect(first).toBe(second);
    expect(await first).toBe(42);
    expect(called).toBe(1);
    expect(accepted).toEqual([42]);
    await submissions.run(1, request, () => {});
    expect(called).toBe(2);
});

test("late responses cannot update a new account or remove its request", async () => {
    const submissions = new ScopedSubmissions<number>();
    let finishOld!: (value: number) => void;
    let finishNew!: (value: number) => void;
    const accepted: number[] = [];
    submissions.setScope({ account: "a" });
    const old = submissions.run(
        1,
        () =>
            new Promise((resolve) => {
                finishOld = resolve;
            }),
        (value) => accepted.push(value),
    );
    await Promise.resolve();
    submissions.setScope({ account: "b" });
    const fresh = submissions.run(
        1,
        () =>
            new Promise((resolve) => {
                finishNew = resolve;
            }),
        (value) => accepted.push(value),
    );
    await Promise.resolve();
    finishOld(1);
    expect(await old).toBeNull();
    expect(
        submissions.run(
            1,
            async () => 99,
            () => {},
        ),
    ).toBe(fresh);
    finishNew(2);
    expect(await fresh).toBe(2);
    expect(accepted).toEqual([2]);
});

test("requests not yet started are discarded on account change", async () => {
    const submissions = new ScopedSubmissions<number>();
    submissions.setScope({ account: "a" });
    let called = false;
    const result = submissions.run(
        1,
        async () => {
            called = true;
            return 1;
        },
        () => {},
    );
    submissions.setScope({ account: "b" });
    expect(await result).toBeNull();
    expect(called).toBe(false);
});

test("rejected requests release their slot for retry", async () => {
    const submissions = new ScopedSubmissions<number>();
    submissions.setScope("a");
    await expect(
        submissions.run(
            1,
            async () => {
                throw new Error("offline");
            },
            () => {},
        ),
    ).rejects.toThrow("offline");
    expect(
        await submissions.run(
            1,
            async () => 2,
            () => {},
        ),
    ).toBe(2);
});

test("returning to the same account does not revive its previous session", async () => {
    const submissions = new ScopedSubmissions<number>();
    let finish!: (value: number) => void;
    let accepted = false;
    submissions.setScope("a");
    const previous = submissions.run(
        1,
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
        () => {
            accepted = true;
        },
    );
    await Promise.resolve();
    submissions.setScope("b");
    submissions.setScope("a");
    finish(1);
    expect(await previous).toBeNull();
    expect(accepted).toBe(false);
});
