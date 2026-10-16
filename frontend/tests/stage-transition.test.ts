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
    const candidateId = id(state);
    state = stageTransition(state, { type: "ready", id: candidateId });
    return stageTransition(state, { type: "finish", id: candidateId });
}
const showingA = () => commit(createStageTransition(a));

describe("viewer frame handoff", () => {
    test("never clears the displayed frame while loading or decoding", () => {
        const start = showingA();
        const loading = stageTransition(start, { type: "select", target: b });
        expect(loading.displayed).toBe(start.displayed);
        expect(stageTransition(loading, { type: "finish", id: id(loading) })).toBe(loading);
        const ready = stageTransition(loading, { type: "ready", id: id(loading) });
        expect(ready.displayed).toBe(start.displayed);
        expect(commit(loading).displayed?.src).toBe("b");
    });

    test("A→B→C ignores B's late readiness, failure and completion", () => {
        const pendingB = stageTransition(showingA(), { type: "select", target: b });
        const pendingC = stageTransition(pendingB, { type: "select", target: c });
        for (const type of ["ready", "fail", "fade", "finish"] as const) {
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

    test("during a fade only the latest intent is retained, with two frames maximum", () => {
        let state = stageTransition(showingA(), { type: "select", target: b });
        const fadingId = id(state);
        state = stageTransition(state, { type: "ready", id: fadingId });
        state = stageTransition(state, { type: "fade", id: fadingId });
        for (const target of [a, c, a, c]) {
            state = stageTransition(state, { type: "select", target });
            expect(state.displayed?.src).toBe("a");
            expect(state.candidate?.src).toBe("b");
        }
        state = stageTransition(state, { type: "finish", id: fadingId });
        expect(state.displayed?.src).toBe("b");
        expect(state.candidate?.src).toBe("c");
        expect(state.phase).toBe("loading");
        expect(stageTransition(state, { type: "finish", id: fadingId })).toBe(state);
        expect(commit(state).displayed?.src).toBe("c");
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
