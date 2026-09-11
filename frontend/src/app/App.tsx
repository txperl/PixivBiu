import { useLayoutEffect, useState } from "react";
import { RouterProvider } from "react-router/dom";
import WindowLayout from "@/app/layouts/window-layout";
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
            <WindowLayout>
                <RouterProvider router={router} />
            </WindowLayout>
        </AppProviders>
    );
}

export default App;
