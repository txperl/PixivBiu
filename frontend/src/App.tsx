import { useLayoutEffect, useState } from "react";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import RootLayout from "@/components/layout/RootLayout";
import { AuthProvider } from "@/lib/auth";
import { LocaleProvider } from "@/lib/i18n";
import { DEFAULT_SEED_COLOR, setColorScheme } from "@/lib/theme/dynamic-color";
import Home from "@/pages/Home";

const router = createBrowserRouter([
    {
        path: "/",
        element: <RootLayout />,
        children: [{ index: true, element: <Home /> }],
    },
]);

function App() {
    const [isInitialized, setIsInitialized] = useState(false);

    useLayoutEffect(() => {
        setColorScheme(DEFAULT_SEED_COLOR);
        setIsInitialized(true);
    }, []);

    return isInitialized ? (
        <LocaleProvider>
            <AuthProvider>
                <RouterProvider router={router} />
            </AuthProvider>
        </LocaleProvider>
    ) : null;
}

export default App;
