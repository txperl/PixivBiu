import { useLayoutEffect } from "react";
import { DEFAULT_SEED_COLOR, setColorScheme } from "./dynamic-color";

export function useDynamicTheme(seed: string = DEFAULT_SEED_COLOR): void {
    useLayoutEffect(() => {
        setColorScheme(seed);
    }, [seed]);
}
