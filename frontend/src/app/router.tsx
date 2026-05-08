import { createBrowserRouter } from "react-router";
import RootLayout from "@/app/layouts/root-layout";
import Home from "@/pages/home";
import RankingPage from "@/pages/ranking";
import SearchPage from "@/pages/search";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <RootLayout />,
        children: [
            { index: true, element: <Home /> },
            { path: "search", element: <SearchPage /> },
            { path: "search/:keyword", element: <SearchPage /> },
            { path: "ranking", element: <RankingPage /> },
        ],
    },
]);
