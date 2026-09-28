import { Navigate, type RouteObject } from "react-router";
import type { KeepAliveHandle } from "@/app/keep-alive/instance-key";
import DownloadsPage from "@/pages/downloads";
import Home from "@/pages/home";
import MeRedirect from "@/pages/me/me-redirect";
import RankingPage from "@/pages/ranking";
import SearchPage from "@/pages/search";
import SettingsPage from "@/pages/settings";
import UserPage from "@/pages/user";

const uncached: KeepAliveHandle = { keepAlive: false };

// Pages under the authenticated layout. The data router only mounts RootLayout at
// "/*"; KeepAliveOutlet renders these per kept-alive instance with that instance's
// own frozen location (see app/keep-alive).
export const appRoutes: RouteObject[] = [
    { index: true, element: <Home /> },
    { path: "search", element: <SearchPage /> },
    { path: "search/:keyword", element: <SearchPage /> },
    { path: "ranking", element: <RankingPage /> },
    { path: "user/:id", element: <UserPage /> },
    { path: "me/:tab?", element: <MeRedirect />, handle: uncached },
    { path: "downloads", element: <DownloadsPage /> },
    { path: "settings", element: <SettingsPage /> },
    { path: "*", element: <Navigate to="/" replace />, handle: uncached },
];
