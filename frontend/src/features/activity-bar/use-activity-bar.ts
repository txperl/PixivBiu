import { useContext } from "react";
import { ActivityBarContext, type ActivityBarContextValue } from "./activity-bar-context";

export function useActivityBar(): ActivityBarContextValue {
    const ctx = useContext(ActivityBarContext);
    if (!ctx) throw new Error("useActivityBar must be used inside <ActivityBarProvider>");
    return ctx;
}
