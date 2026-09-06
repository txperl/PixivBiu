# PixivBiu Frontend

React + Vite + TypeScript SPA, with Base UI/shadcn primitives, Tailwind, Material You colors, TanStack Query, and Paraglide i18n. Dependency versions live in [package.json](package.json) and the Bun lockfile.

For first checkout, core builds, and API generation order, see [Development](../docs/DEVELOPMENT.md). This guide owns frontend implementation patterns; repository-wide constraints are in [AGENTS.md](../AGENTS.md).

## Commands

Run inside `frontend`:

```sh
bun install --frozen-lockfile
bun run dev
```

The install compiles i18n messages. Vite normally serves on 5173 and proxies `/api` to the backend on 4001; start `make dev` separately from the repo root.

| Command | Effect |
| --- | --- |
| `bun run build` | Compile messages, type-check, and build into `../internal/web/dist` |
| `bunx @biomejs/biome ci .` | Read-only lint/format check used by CI |
| `bun run check` | Apply Biome lint/format fixes |
| `bun run check:unsafe` | Apply fixes including unsafe ones; review the diff |
| `bun run paraglide:compile` | Regenerate gitignored message output |
| `bun run gen:api` | Generate committed API types from the running core's `/openapi.json` |

After changing OpenAPI, regenerate Go and restart the backend before `gen:api`. Never hand-edit `src/lib/api/schema.gen.ts` or i18n generated output.

## Structure and providers

- `src/app`: providers, router, and layouts.
- `src/pages/<route>`: thin route shells; `index.tsx` only default-exports the route component. Shared helpers/constants/types live in sibling files.
- `src/features/<domain>`: business API adapters, hooks/state, and UI.
- `src/components`: cross-feature UI; `ui` contains the shared primitives.
- `src/lib`: utilities, API client, query helpers, theme, and desktop bridge.
- `src/i18n`: source messages, inlang config, generated output, and React bindings.

Use kebab-case filenames. Read [providers.tsx](src/app/providers.tsx) before changing provider placement. Its dependency order is:

```text
QueryClientProvider → TooltipProvider → LocaleProvider → AuthProvider
→ EventStreamProvider → DownloadStateProvider → UpdateProvider → ActivityBarProvider
```

Locale synchronization and account-cache reset are auth-gated children. The Query client is a singleton so it survives component rerenders.

## API and query state

Components call feature `api.ts` adapters rather than openapi-fetch directly. The shared client uses `/api/v1`, adds `X-PixivBiu-App`, and normalizes transport failures or empty non-success responses into the error contract. Preserve that behavior so a dead backend cannot be mistaken for a successful mutation.

Feature query-options factories own query keys and fetching. Adapt `{data, error}` results with `unwrap` for Query's throw-on-error contract. Use stable domain/parameter keys; avoid recreating pagination policy per page.

| List type | Pattern |
| --- | --- |
| Numbered offset/cursor lists | Factory owns `keepPreviousPage(params, pageKeys)`; keep data only across pagination changes |
| Details | No previous-entity placeholder on identity changes |
| Home load-more feeds | `offsetInfiniteQueryOptions` centralizes numeric offsets and next-page extraction |
| Settings | Deliberate `FetchState` form loader plus shared config-query synchronization |
| Downloads | REST page state plus SSE patches through download hooks |

Plain `keepPreviousData` also keeps data across filter/user changes, so it is not a replacement for the numbered-list helper. Home feeds use it only where their separate hook lifecycle prevents another list's data from bleeding in. Use ranking, user tabs, and home illust tabs as examples.

The default Query policy is a one-minute stale time, five-minute unused cache, one retry, and no window-focus refetch. The authority is [client.ts](src/lib/query/client.ts). This is client caching; a backend search-result cache remains unimplemented.

### Account boundaries and mutations

`AuthGatedQueryReset` clears Query state when the session changes. Cached artwork includes account-specific bookmark/follow data and must not cross accounts.

Bookmark state belongs to cached illustrations. The shared `useIllustBookmark` hook serves cards and the viewer: it cancels conflicting full refetches, patches every cached illustration copy through `usePatchCachedIllust`, rolls back on failure, and reconciles detail/list state on settlement. Preserve its exceptions for initial loads and infinite "load more" requests so those are not stranded. Do not introduce a parallel local bookmark flag/count.

Follow buttons use local optimism via `usePropSyncedState`, adopting fresh server props when no mutation is pending. Successful mutations invalidate affected lists through `useInvalidateIllustLists`. The helper marks them stale without immediate refetch storms; the next mount refreshes them.

Settings' `applyView` mirrors adopted saves/resets/refetches into `CONFIG_QUERY_KEY`. Keep that path so consumers such as ranked-search page-size calculation immediately see settings changes. Restart and update flows use `pollUntil` for authoritative catch-up rather than relying only on an SSE edge.

## Events and downloads

`EventStreamProvider` opens EventSource while authenticated, closes it on logout, and exposes topic subscriptions. Use `useRefreshOnReconnect` to refetch after connection establishment/reconnection and `system.resync`. REST remains authoritative.

| Hook | Responsibility |
| --- | --- |
| `useTrackedDownloads` | Global artwork-to-job map for active and recent terminal jobs |
| `useDownloadCounts` | Global active/done counts from job events |
| `useDownloadMutations` | Submit/cancel/remove/clear actions; events drive resulting state |
| `useDownloadsPage` | Instance-local server pagination; job events refetch, task events patch |
| `useIllustDownload` | Shared card/viewer enqueue, status, just-sent and error behavior |

Only `download.job.*` events update client job status. Task events update tasks, not a client-derived job aggregation. Use `ACTIVE_STATUSES` for in-flight status. Artwork progress is a byte ratio, indeterminate when any size is unknown; `DownloadsTable` job progress is count-weighted. Don't interchange them.

## Localization and errors

Read text in render paths using `const m = useMessages()` from `@/i18n`. It subscribes to locale changes. Module-level imports/evaluated UI text freeze the language; move UI constants into render or memoized work with correct dependencies. Dynamic message selection uses explicit static maps.

[Message conventions](src/i18n/messages/README.md) own naming and parameter rules: all four locales must have matching keys/parameters. Do not duplicate those rules in new message metadata keys.

Locale resolution has two stages. Before login, an existing Paraglide localStorage choice wins; on a first visit, navigator languages are prefix-matched (Traditional Chinese regions/Hant before generic Chinese, then Japanese/English). After auth, LocaleSync applies persisted `app.language`. Settings applies a language change synchronously without page reload or remount.

`useApiErrorMessage` renders non-empty `kind=app` messages verbatim; otherwise it resolves upstream reason, then error code, then the message fallback. Validation details come from `fields`; expose request IDs for internal failures. Do not render raw upstream bodies.

Settings labels use explicit `useFieldText/useSectionTitle` maps. Missing translations fall back to the raw field key/section ID. Backend schema supplies structure and flags, not human-readable UI text.

## Shared UI patterns

- Compose classes with `cn(...)`, not template literals. Reuse Base UI/shadcn primitives, Material You tokens, root tooltips, and accessible control labels.
- Render Pixiv images with `PximgImage`. It rewrites to the same-origin proxy, keeps a caller-sized fallback underlay, and fades in after load/decode. `fit="cover"` suits thumbnails; `fit="contain"` suits the viewer. `className` styles the wrapper, not the inner image. Use `onLoad(img)` for natural dimensions; don't force eager decode and defeat lazy loading.
- Numbered lists wrap results in `ListLoadingOverlay`, active on `query.isPlaceholderData`. This explains slow page steps while previous data remains visible. Cursor-walk skeletons take precedence. Cold settings/download loaders use `useDelayedFlag` to avoid flashes and premature empty states.
- Pipe list results through `useFilteredIllusts`; register `useFilterPanel` with filter rows, counts, reset, and quick actions. Use `useIllustSelection` for batch work and clear selection on list-identity/page changes.
- New activity-bar panels use typed item hooks/payloads, a panel component, and registration in `ITEM_DEFS`. Export typed panel/data hooks from the barrel.
- Reuse `DownloadsTable`; its compact mode hides headers/size/actions.
- The page scroll root is the Base UI ScrollArea viewport tagged `data-app-scroller`, not `main` or window. Use shared scroll helpers for pagers, scroll-spy, and observers. New persistent scroll regions use ScrollArea with appropriate flex sizing; transient popups keep their scoped native bars.
- Use `src/lib/format.ts` for counts, bytes, and dates, preserving artwork source-timezone dates and locale-aware relative-time formatting.

## Desktop integration

Feature-detect the [desktop bridge](src/lib/desktop.ts); browser builds have none. The login page uses captured OAuth codes in desktop and manual callback/token entry in a browser. UpdateProvider maps its existing UI onto `window.pixivbiu.updates` instead of the core update endpoints.

Keep the frontend interface aligned with [preload.ts](../desktop/src/preload.ts). Renderers use the stable `pixivbiu://core` origin, not the private sidecar port. Chrome flags come from the shell: absent flags fall back to framed/opaque. Use the existing drag/no-drag conventions for interactive controls. The [desktop guide](../desktop/README.md) owns protocol, IPC, window and release details.

## Behavioral checks

In addition to Biome/build, exercise the behavior touched by a UI change: account switches, bookmark card/viewer agreement and rollback, pagination versus filter changes, slow loading, SSE reconnect/resync, language changes without reload, image fallback/lazy loading, and scroll-root behavior. For bridge changes, check both browser and native desktop paths. The build does not verify these interactions automatically.
