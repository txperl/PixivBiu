import { m } from "../generated/messages";
import { useLocale } from "./locale-provider";

// useLocale() subscribes callers to locale changes so m.xxx() re-evaluates on rerender.
export function useMessages() {
    useLocale();
    return m;
}
