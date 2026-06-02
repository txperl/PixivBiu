import { useContext } from "react";
import { UpdateContext } from "./update-context";

export function useUpdate() {
    const ctx = useContext(UpdateContext);
    if (!ctx) throw new Error("useUpdate must be used inside <UpdateProvider>");
    return ctx;
}
