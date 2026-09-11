import { createContext, useContext } from "react";

// Portal positioning must use the content rectangle, excluding native chrome.
// Undefined preserves Base UI's normal browser/macOS/Linux collision policy.
export const WindowContentBoundary = createContext<DOMRect | undefined>(undefined);

export function useWindowContentBoundary() {
    return useContext(WindowContentBoundary);
}
