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
| `bun run test` | Selection and submission state tests (Bun, no DOM or Pixiv calls) |
| `bun run build` | Compile messages, type-check, and build into `../internal/web/dist` |
| `bunx @biomejs/biome ci .` | Read-only lint/format check used by CI |
| `bun run check` | Apply Biome lint/format fixes |
| `bun run check:unsafe` | Apply fixes including unsafe ones; review the diff |
| `bun run paraglide:compile` | Regenerate gitignored message output |
| `bun run gen:api` | Generate committed API types from the running core's `/openapi.json` |

After changing OpenAPI, regenerate Go and restart the backend before `gen:api`. Never hand-edit `src/lib/api/schema.gen.ts` or i18n generated output.

Use `bun run build` for distributable assets: after type checking it cleans previous output from `internal/web/dist`, preserving `.gitkeep`, before running Vite. This also covers Make, core releases and Docker. Invoking `vite build` alone bypasses cleanup and can retain stale hashed assets; `make build` embeds the output directory as it stands.

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

## Routing and page lifecycle

The data router ([router.tsx](src/app/router.tsx)) only mounts `/login` and `RootLayout` at `/*`. Authenticated pages live in [routes.tsx](src/app/routes.tsx) and are rendered by `KeepAliveOutlet` ([app/keep-alive](src/app/keep-alive)), which keeps visited pages mounted behind React's `<Activity>` so switching sections or going Back/Forward returns to a page exactly as it was left: component state, loaded content, and scroll.

- Each page instance renders the route table against its own frozen location, so a hidden page's `useLocation`/`useSearchParams`/`useParams` keep reading its own URL. Instances are keyed by pathname (search params update the visible instance in place); the signed-in user's `/user/:id` splits by sidebar section (works/bookmarks/following). Routes with `handle: { keepAlive: false }` (redirects, the fallback) render uncached.
- At most eight instances are kept (least recently shown evicted first), and one hidden longer than the idle TTL is remounted fresh; the TTL stays below `QUERY_GC_TIME` so a returning page never finds its data half-collected. The outlet and section memory are keyed by account.
- Scroll of `[data-app-scroller]` is saved per instance and restored on return; new instances start at the top.
- The sidebar ([sections.ts](src/app/sections.ts), `SectionMemoryProvider`) links each item to its section's last visited URL, minus overlay params such as `?illust`. Clicking the active item steps back one level per click: to the section's landing view, then to its top, then refreshes it. Refresh is opt-in: a page registers `usePageRefresh` with what refreshing means for it (re-pull its current list from page 1, keeping filters and tabs; numbered lists use `resetNumberedList`). Pages without a handler, such as settings with its unsaved drafts, are left alone.
- A hidden page's effects are torn down and re-run when it is shown again. Mount-time work must therefore be idempotent: guard one-time loads, react to navigation with `useChangeEffect` rather than a plain effect, and never reset user state just because an effect ran. Hidden pages still re-render for context changes at low priority.
- `<Activity>` does not hide portals. The shared popup roots (popover, tooltip, menu, dialog) close and unmount themselves when their page is hidden via `useCloseOnHide`; a new portal-based primitive should do the same.

## API and query state

Components call feature `api.ts` adapters rather than openapi-fetch directly. The shared client uses `/api/v1`, adds `X-PixivBiu-App`, and normalizes transport failures or empty non-success responses into the error contract. Preserve that behavior so a dead backend cannot be mistaken for a successful mutation.

Feature query-options factories own query keys and fetching. Adapt `{data, error}` results with `unwrap` for Query's throw-on-error contract. Use stable domain/parameter keys; avoid recreating pagination policy per page.

| List type | Pattern |
| --- | --- |
| Numbered offset/cursor lists | Factory owns `keepPreviousPage(params, pageKeys)`; keep data only across pagination changes. Pixiv reports no totals, so the page records what each fetched page proves in `usePageFrontier` (bookmark cursor chains included) and renders the shared `Pager` from it: only confirmed pages, profile totals as a hint, prefetch on hover/focus, `PageBeyondEnd` for an empty page past the first |
| Details | No previous-entity placeholder on identity changes |
| Home load-more feeds | `offsetInfiniteQueryOptions` centralizes numeric offsets and next-page extraction |
| Settings | Deliberate `FetchState` form loader plus shared config-query synchronization |
| Downloads | REST page state plus SSE patches through download hooks |

Plain `keepPreviousData` also keeps data across filter/user changes, so it is not a replacement for the numbered-list helper. Home feeds use it only where their separate hook lifecycle prevents another list's data from bleeding in. Use ranking, user tabs, and home illust tabs as examples.

The default Query policy is a one-minute stale time, thirty-minute unused cache, refetch on mount only when invalidated, one retry, and no window-focus refetch. The authority is [client.ts](src/lib/query/client.ts). Returning to a page (remount or `<Activity>` reveal) therefore shows it as left; time-based staleness still applies to parameter changes and newly enabled queries. Factories that must refresh on open opt back in with `refetchOnMount` (illust detail, config). The recommended feed never refreshes on its own (infinite stale time, no mount refetch, skipped by list invalidation) because re-pulling reshuffles it; only its refresh button or a filter change loads a new one. This is client caching; a backend search-result cache remains unimplemented.

### Account boundaries and mutations

`AuthGatedQueryReset` clears Query state when the session changes. Cached artwork includes account-specific bookmark/follow data and must not cross accounts.

Bookmark state belongs to cached illustrations. The shared `useIllustBookmark` hook serves cards and the viewer: it cancels conflicting full refetches, patches every cached illustration copy through `usePatchCachedIllust`, rolls back on failure, and reconciles detail/list state on settlement. Preserve its exceptions for initial loads and infinite "load more" requests so those are not stranded. Do not introduce a parallel local bookmark flag/count.

Follow buttons use local optimism via `usePropSyncedState`, adopting fresh server props when no mutation is pending. Successful mutations invalidate affected lists through `useInvalidateIllustLists`. The helper marks them stale without immediate refetch storms; the next mount or return to a kept page refreshes them in the background. Non-list queries and lists that must not refresh opt out with `meta: SKIP_LIST_INVALIDATION`.

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

### Batch selection and submission

`IllustSelectionProvider` lives inside the account-keyed root layout. Each kept page owns a DOM-free `IllustSelectionStore` and registers a controller with its focus-return callback. Layout-effect registration is removed while the page is hidden and restored on reveal without resetting state. The shared action bar is a sibling of the main ScrollArea, anchored to the main panel's bottom-right corner below popup layers. Its measured height reserves scroll content and focus-scroll space; do not portal it to the window or attach it to the filter panel. Use equally sized compact buttons with consistent gaps; show the count in the selection status and keep the download label short. The bar provides select-all, download, and exit; there is no separate clear button.

Artwork card checkboxes enter selection mode; there is no selection control in the list header. The store's `toggleAll` action owns the selection toggle: any nonempty selection clears, while zero selection selects all. Deselect keeps the bar open, so the user can select all again; the close control exits, and deselecting the last card also exits. The select-all label stays short with its scope in the tooltip. All-select covers filtered works on the current numbered page or already loaded feed pages; loading more never adds selection automatically. Server-side list identities (including page, user, tab, and search/filter parameters) reset selection, while same-list filtering/refetch intersects it with the current results. Temporary loading/placeholder states disable edits without treating missing data as an empty result; only usable results prune the previous selection. Kept-page navigation preserves it. The selection hook exposes only selected IDs, mode, disabled state, and the card toggle handler.

Batch enqueue uses at most four workers and checks current tracked queued/running jobs before each submit. Each batch captures its list revision and owns that list's submit lock. Changing lists detaches the old lock and progress so the new list can be edited; the old batch continues but cannot clear the new batch's lock or adopt its results. Same-list filtering retains the batch and reconciles outcomes against the remaining visible IDs; an empty intersection or explicit exit prevents reopening selection. Successful/existing jobs leave the selection; visible failed submits remain selected for retry. Counts describe enqueue outcomes, not download completion. The shared download submit path coalesces in-flight calls per artwork and committed session; account changes revoke unsent batch work and prevent adopting old responses. Already dispatched requests and accepted downloads are not rolled back. Escape exits from artwork checkboxes while respecting text inputs and open popup layers. Card handlers pass the actual selection control to the hook, rather than inferring it from global focus. When selection ends with focus owned by the action bar (including blur caused by disabling the submit button), one layout effect returns focus with `preventScroll`, covering close, Escape, and successful submission without pulling the viewport to that card.

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
- Pipe list results through `useFilteredIllusts`; register `useFilterPanel` with filter rows, counts, and reset. Batch actions are independent of the filter panel: use `useIllustSelection` with the list identity, filtered IDs, readiness, and page/loaded scope. Pass its toggle handler and explicit mode/disabled state to `IllustGrid`; artwork cards provide the selection entry.
- New activity-bar panels use typed item hooks/payloads, a panel component, and registration in `ITEM_DEFS`. Export typed panel/data hooks from the barrel.
- Reuse `DownloadsTable`; its compact mode hides headers/size/actions.
- The page scroll root is the Base UI ScrollArea viewport tagged `data-app-scroller`, not `main` or window. Use shared scroll helpers for pagers, scroll-spy, and observers. New persistent scroll regions use ScrollArea with appropriate flex sizing; transient popups keep their scoped native bars.
- Use `src/lib/format.ts` for counts, bytes, and dates, preserving artwork source-timezone dates and locale-aware relative-time formatting.

## Desktop integration

Feature-detect the [desktop bridge](src/lib/desktop.ts); browser builds have none. The login page uses captured OAuth codes in desktop and manual callback/token entry in a browser. UpdateProvider maps its existing UI onto `window.pixivbiu.updates` instead of the core update endpoints.

The release-notes dialog accepts core Markdown and the HTML notes supplied by electron-updater's GitHub feed. Run `rehype-raw` before `rehype-sanitize` so both formats share the same styled React elements while scripts, event handlers, unsafe URLs and embedded SVG are removed by the default sanitization schema. Keep sanitization after HTML parsing.

Desktop restores an explicit set of UI preferences through `lib/preferences.ts` before dynamically importing App. Use `writePreference` for persisted UI writes; direct localStorage writes in desktop are memory-only. The shell owns a versioned, bounded file and validates every IPC request. Browser builds continue using localStorage. Paraglide’s locale cache is restored before its runtime initializes and is saved by LocaleProvider when applying language.

Keep the frontend interface aligned with [preload.ts](../desktop/src/preload.ts). Renderers use the stable `pixivbiu://core` origin, not the private sidecar port. Chrome flags come from the shell: absent flags fall back to framed/opaque. Use the existing drag/no-drag conventions for interactive controls. The [desktop guide](../desktop/README.md) owns protocol, IPC, window and release details.

`WindowLayout` wraps all routes and owns the Windows title-bar row plus the remaining content viewport (`data-window-content`). Route roots use `h-full`, not `h-svh`; `--window-content-top` and `--window-content-height` are the shared geometry contract. The application page scroller remains `[data-app-scroller]`. Windows uses the explicit top bar and main sidebar for dragging: `data-window-sidebar` opts that sidebar into `app-drag` and scopes its control exceptions. Other `app-drag` surfaces, including the activity rail, only activate in the macOS frameless shell. Native/HTML fullscreen removes reserved chrome, with read-only state from the optional `windowChrome` bridge and a DOM fullscreen fallback.

macOS keeps the invisible 44px top drag band without adding a toolbar or page padding. `desktop.css` limits automatic `no-drag` exceptions to controls inside `app-drag`, semantic headers/forms/navigation/toolbars/tab lists, and explicit `data-app-controls` groups; on Windows only the main sidebar gets automatic control exceptions. Mark a custom action row or settings form with `data-app-controls`; mark a custom interactive widget with `data-app-no-drag` (or `app-no-drag`) on either desktop platform. The group marker itself does not disable dragging in its empty space. Do not put these markers around artwork feeds or cards: ordinary content remains undeclared and clickable below the drag band, while artwork passing underneath the band must not change window dragging. Electron's native region calculation can include clipped, scrolled `no-drag` boxes; global declarations or explicit `app-region: none` resets reintroduce invisible holes. Shared portal surfaces, modal backdrops, scrollbars and resize handles have exceptions on both Windows and macOS so they receive pointer input over draggable sidebars. These rules are inactive in browser/Linux and in fullscreen.

Portal UI must respect the same content viewport. Shared Dialog CSS centers and bounds Windows popups below the caption strip; a dialog with its own scroll regions can retain `overflow-hidden`. Viewer height derives from `--window-content-height`. Anchored primitives consume `useWindowContentBoundary()` for Base UI collision handling; the measured rectangle updates as the content resizes. Windows selects disable viewport-based item alignment while the inset is present. Use these shared primitives for new floating UI rather than positioning directly against the entire window. Browser, Linux and macOS retain their normal collision policy.

## Behavioral checks

In addition to Biome/build, exercise the behavior touched by a UI change: account switches, bookmark card/viewer agreement and rollback, pagination versus filter changes, slow loading, SSE reconnect/resync, language changes without reload, image fallback/lazy loading, scroll-root behavior, and page keep-alive (switch sections and go Back/Forward, then check that state, scroll, and open popups behave and nothing refetches unexpectedly). For bridge changes, check both browser and native desktop paths. The build does not verify these interactions automatically.
