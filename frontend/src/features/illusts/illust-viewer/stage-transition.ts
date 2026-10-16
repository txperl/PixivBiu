export type StageTarget = { index: number; src: string };
export type StageFrame = StageTarget & { id: number };
export type StageTransition = {
    target: StageTarget;
    displayed: StageFrame | null;
    candidate: StageFrame | null;
    phase: "idle" | "loading" | "error";
    generation: number;
};
type Action = { type: "select"; target: StageTarget } | { type: "retry" } | { type: "ready" | "fail"; id: number };

const same = (a: StageTarget, b: StageTarget) => a.index === b.index && a.src === b.src;

function prepare(state: StageTransition, target: StageTarget): StageTransition {
    if (state.displayed && same(state.displayed, target)) {
        return { ...state, target, candidate: null, phase: "idle" };
    }
    const generation = state.generation + 1;
    return { ...state, target, generation, candidate: { ...target, id: generation }, phase: "loading" };
}

export function createStageTransition(target: StageTarget): StageTransition {
    return prepare({ target, displayed: null, candidate: null, phase: "idle", generation: 0 }, target);
}

// Keep the old frame until the latest candidate is decoded, then replace it in
// one commit. Superseded candidates can never change the displayed image.
export function stageTransition(state: StageTransition, action: Action): StageTransition {
    if (action.type === "select") {
        if (same(state.target, action.target)) return state;
        return prepare(state, action.target);
    }
    if (action.type === "retry") return state.phase === "error" ? prepare(state, state.target) : state;
    if (state.candidate?.id !== action.id) return state;
    switch (action.type) {
        case "ready":
            return state.phase === "loading"
                ? { ...state, displayed: state.candidate, candidate: null, phase: "idle" }
                : state;
        case "fail":
            return state.phase === "loading" ? { ...state, phase: "error" } : state;
    }
}
