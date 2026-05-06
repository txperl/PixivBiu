import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
// Must come after globals.css so M3 → shadcn mappings override shadcn defaults.
import "./styles/material-you.css";
import App from "@/app/App";

createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
