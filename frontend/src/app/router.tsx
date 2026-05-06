import { createBrowserRouter } from "react-router";
import RootLayout from "@/app/layouts/root-layout";
import Home from "@/pages/home";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <RootLayout />,
        children: [{ index: true, element: <Home /> }],
    },
]);
