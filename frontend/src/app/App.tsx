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
            <WindowDragStrip />
            <RouterProvider router={router} />
        </AppProviders>
    );
}

// Frameless desktop shell: an invisible full-width strip that drags the window
// from the top band on every route. Negative z-index makes it paint before the
// app UI, so the global no-drag rule in styles/desktop.css can punch holes for
// interactive elements — empty band pixels drag, UI stays clickable. Chromium
// computes drag regions in paint order; a strip painted last would cover the
// holes. Height is 0 in the browser — renders as nothing.
function WindowDragStrip() {
    return (
        <div className="app-drag -z-10 fixed inset-x-0 top-0" style={{ height: "var(--titlebar-inset, 0px)" }} />
    );
}

export default App;
