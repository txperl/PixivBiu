export type StageTarget = { index: number; src: string };
export type StageFrame = StageTarget & { id: number };
export type StageTransition = {
    target: StageTarget;
    displayed: StageFrame | null;
    candidate: StageFrame | null;
    phase: "idle" | "loading" | "ready" | "fading" | "error";
    generation: number;
};
type Action =
    | { type: "select"; target: StageTarget }
    | { type: "retry" }
    | { type: "ready" | "fail" | "fade" | "finish"; id: number };

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

// Only an already-visible fade is allowed to finish after another selection.
// Loading/ready candidates are replaceable, and old async results cannot commit.
export function stageTransition(state: StageTransition, action: Action): StageTransition {
    if (action.type === "select") {
        if (same(state.target, action.target)) return state;
        if (state.phase === "fading") return { ...state, target: action.target };
        return prepare(state, action.target);
    }
    if (action.type === "retry") return state.phase === "error" ? prepare(state, state.target) : state;
    if (state.candidate?.id !== action.id) return state;
    switch (action.type) {
        case "ready":
            return state.phase === "loading" ? { ...state, phase: "ready" } : state;
        case "fail":
            return state.phase === "loading" ? { ...state, phase: "error" } : state;
        case "fade":
            return state.phase === "ready" ? { ...state, phase: "fading" } : state;
        case "finish":
            if (state.phase !== "ready" && state.phase !== "fading") return state;
            return prepare({ ...state, displayed: state.candidate, candidate: null, phase: "idle" }, state.target);
    }
}
