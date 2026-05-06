# PixivBiu Frontend

React 19 + Vite + TypeScript SPA. Talks to the Go backend at `/api/v1/*` (Vite dev proxy in `vite.config.ts`).

For architecture, directory layout, i18n, and OpenAPI codegen workflow, see [`../AGENTS.md`](../AGENTS.md).

## Commands

```bash
bun install            # also runs paraglide:compile via postinstall
bun run dev            # vite dev server :5173
bun run build          # paraglide compile + tsc -b + vite build
bun run check          # biome check --write (lint + format)
bun run gen:api        # regenerate src/lib/api/schema.gen.ts from running backend's /openapi.json
```

`bun run gen:api` requires the backend to be up (`make dev` from repo root). Equivalent to `make gen-frontend` from the repo root.
