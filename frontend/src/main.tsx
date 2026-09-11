import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
// Must come after globals.css so M3 → shadcn mappings override shadcn defaults.
import "./styles/material-you.css";
// Desktop-shell overrides; after material-you.css so frost tints win.
import "./styles/desktop.css";
import { applyDesktopChrome } from "@/lib/desktop-chrome";
import { restoreDesktopPreferences } from "@/lib/preferences";

// Before first paint: mark <html> with the Electron shell's window chrome.
const disposeDesktopChrome = applyDesktopChrome();
if (import.meta.hot) import.meta.hot.dispose(disposeDesktopChrome);

async function start() {
    await restoreDesktopPreferences();
    const { default: App } = await import("@/app/App");
    createRoot(document.getElementById("root") as HTMLElement).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}

void start();
