import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
// Must come after globals.css so M3 → shadcn mappings override shadcn defaults.
import "./styles/material-you.css";
// Desktop-shell overrides; after material-you.css so frost tints win.
import "./styles/desktop.css";
import App from "@/app/App";
import { applyDesktopChrome } from "@/lib/desktop-chrome";

// Before first paint: mark <html> with the Electron shell's window chrome.
applyDesktopChrome();

createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
