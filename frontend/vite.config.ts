import path from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        paraglideVitePlugin({
            project: "./src/i18n/project.inlang",
            outdir: "./src/i18n/generated",
            // No `preferredLanguage` — the frontend never sniffs navigator.language.
            // The LocaleProvider fetches GET /api/v1/i18n on mount and `setLocale()`s
            // to whatever the backend resolved, so `app.language` is the single
            // source of truth. `localStorage` only serves as a first-paint cache.
            strategy: ["localStorage", "baseLocale"],
            emitTsDeclarations: true,
        }),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        proxy: {
            "/api": "http://localhost:8080",
        },
    },
});
