import { useLayoutEffect, useState } from "react";
import { RouterProvider } from "react-router/dom";
import { AppProviders } from "@/app/providers";
import { router } from "@/app/router";
import { DEFAULT_SEED_COLOR, setColorScheme } from "@/lib/theme/dynamic-color";

function App() {
    const [isInitialized, setIsInitialized] = useState(false);

    useLayoutEffect(() => {
        setColorScheme(DEFAULT_SEED_COLOR);
        setIsInitialized(true);
    }, []);

    if (!isInitialized) return null;

    return (
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    );
}

export default App;
