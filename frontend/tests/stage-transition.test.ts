import { describe, expect, test } from "bun:test";
import {
    createStageTransition,
    type StageTransition,
    stageTransition,
} from "../src/features/illusts/illust-viewer/stage-transition";

const a = { index: 0, src: "a" };
const b = { index: 1, src: "b" };
const c = { index: 2, src: "c" };
const id = (state: StageTransition) => {
    if (!state.candidate) throw new Error("Expected a candidate");
    return state.candidate.id;
};
function commit(state: StageTransition) {
    return stageTransition(state, { type: "ready", id: id(state) });
}
const showingA = () => commit(createStageTransition(a));

describe("viewer frame handoff", () => {
    test("keeps the old frame until decoding, then replaces it in one commit", () => {
        const start = showingA();
        const loading = stageTransition(start, { type: "select", target: b });
        expect(loading.displayed).toBe(start.displayed);
        const ready = stageTransition(loading, { type: "ready", id: id(loading) });
        expect(ready.displayed).toBe(loading.candidate);
        expect(ready.candidate).toBeNull();
        expect(ready.phase).toBe("idle");
        expect(stageTransition(ready, { type: "ready", id: id(loading) })).toBe(ready);
    });

    test("A→B→C ignores B's late readiness and failure", () => {
        const pendingB = stageTransition(showingA(), { type: "select", target: b });
        const pendingC = stageTransition(pendingB, { type: "select", target: c });
        for (const type of ["ready", "fail"] as const) {
            expect(stageTransition(pendingC, { type, id: id(pendingB) })).toBe(pendingC);
        }
        expect(pendingC.displayed?.src).toBe("a");
        expect(commit(pendingC).displayed?.src).toBe("c");
    });

    test("A→B→A cancels the candidate without replaying A", () => {
        const start = showingA();
        const pending = stageTransition(start, { type: "select", target: b });
        const back = stageTransition(pending, { type: "select", target: a });
        expect(back.displayed).toBe(start.displayed);
        expect(back.candidate).toBeNull();
        expect(back.phase).toBe("idle");
        expect(stageTransition(back, { type: "ready", id: id(pending) })).toBe(back);
    });

    test("a new selection replaces the pending candidate immediately", () => {
        let state = stageTransition(showingA(), { type: "select", target: b });
        const supersededId = id(state);
        for (const target of [c, b, c]) {
            state = stageTransition(state, { type: "select", target });
            expect(state.displayed?.src).toBe("a");
            expect(state.candidate?.src).toBe(target.src);
            expect(state.phase).toBe("loading");
        }
        expect(stageTransition(state, { type: "ready", id: supersededId })).toBe(state);
        const shown = commit(state);
        expect(shown.displayed?.src).toBe("c");
        const next = stageTransition(shown, { type: "select", target: b });
        expect(next.displayed).toBe(shown.displayed);
        expect(next.candidate?.src).toBe("b");
    });

    test("failure retains the old frame; retry has a fresh generation", () => {
        let state = stageTransition(showingA(), { type: "select", target: b });
        const failedId = id(state);
        state = stageTransition(state, { type: "fail", id: failedId });
        expect(state.displayed?.src).toBe("a");
        expect(state.phase).toBe("error");
        expect(stageTransition(state, { type: "ready", id: failedId })).toBe(state);
        state = stageTransition(state, { type: "retry" });
        expect(id(state)).not.toBe(failedId);
        expect(stageTransition(state, { type: "fail", id: failedId })).toBe(state);
        expect(commit(state).displayed?.src).toBe("b");
    });

    test("initial failure and retry do not invent a displayed page", () => {
        let state = createStageTransition(a);
        state = stageTransition(state, { type: "fail", id: id(state) });
        expect(state.displayed).toBeNull();
        state = stageTransition(state, { type: "retry" });
        expect(commit(state).displayed?.index).toBe(0);
    });

    test("same-work source refresh replaces the frame; unchanged selection is a no-op", () => {
        const state = showingA();
        expect(stageTransition(state, { type: "select", target: { ...a } })).toBe(state);
        const refresh = stageTransition(state, { type: "select", target: { ...a, src: "new-a" } });
        expect(refresh.displayed).toBe(state.displayed);
        expect(commit(refresh).displayed?.src).toBe("new-a");
    });
});
