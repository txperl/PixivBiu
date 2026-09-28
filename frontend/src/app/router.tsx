import { createBrowserRouter } from "react-router";
import RootLayout from "@/app/layouts/root-layout";
import LoginPage from "@/pages/login";

// Authenticated pages are not children here: RootLayout owns them through
// KeepAliveOutlet (page table in app/routes.tsx), so visited pages stay mounted
// across navigation instead of being swapped out by <Outlet/>.
export const router = createBrowserRouter([
    { path: "/login", element: <LoginPage /> },
    { path: "/*", element: <RootLayout /> },
]);
