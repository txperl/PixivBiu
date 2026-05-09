import { createBrowserRouter } from "react-router";
import RootLayout from "@/app/layouts/root-layout";
import Home from "@/pages/home";
import MeRedirect from "@/pages/me/me-redirect";
import RankingPage from "@/pages/ranking";
import SearchPage from "@/pages/search";
import UserPage from "@/pages/user";

export const router = createBrowserRouter([
    {
        path: "/",
        element: <RootLayout />,
        children: [
            { index: true, element: <Home /> },
            { path: "search", element: <SearchPage /> },
            { path: "search/:keyword", element: <SearchPage /> },
            { path: "ranking", element: <RankingPage /> },
            { path: "user/:id", element: <UserPage /> },
            { path: "me/:tab?", element: <MeRedirect /> },
        ],
    },
]);
