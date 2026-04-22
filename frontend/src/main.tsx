import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
// Must come after index.css so M3 → shadcn mappings override shadcn defaults.
import "./lib/theme/material-you.css";
import App from "./App.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
