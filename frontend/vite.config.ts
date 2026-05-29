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
            // No `preferredLanguage` — the LocaleProvider reads `app.language`
            // from GET /api/v1/config on mount and resolves `auto` against
            // navigator.language itself, so the persisted config stays the
            // single source of truth. `localStorage` only serves as a
            // first-paint cache.
            strategy: ["localStorage", "baseLocale"],
            emitTsDeclarations: true,
        }),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    build: {
        // Emit straight into the Go `internal/web` package so go:embed bakes
        // the SPA into the server binary (single self-contained artifact).
        // outDir sits outside the frontend root; emptyOutDir:false preserves
        // the committed dist/.gitkeep (which keeps backend-only `go build`
        // compiling) and avoids Vite's outside-root deletion guard. Stale
        // hashed assets are harmless and cleared by `make clean`.
        outDir: path.resolve(__dirname, "../internal/web/dist"),
        emptyOutDir: false,
    },
    server: {
        proxy: {
            "/api": "http://localhost:8080",
        },
    },
});
