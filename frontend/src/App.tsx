import { useLayoutEffect, useState } from "react";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import RootLayout from "@/components/layout/RootLayout";
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

    return isInitialized ? <RouterProvider router={router} /> : null;
}

export default App;
