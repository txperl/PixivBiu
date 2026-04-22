import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import Home from "@/pages/Home";
import { useDynamicTheme } from "./lib/theme/use-dynamic-theme";

const router = createBrowserRouter([
    {
        path: "/",
        element: <Home />,
    },
]);

function App() {
    useDynamicTheme();

    return <RouterProvider router={router} />;
}

export default App;
