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
| `bun run test` | Selection, submission, and bookmark state tests (Bun, no DOM or Pixiv calls) |
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

Bookmark metadata is shared under `bookmark-detail` by session generation/artwork, and tag catalogs under `bookmark-tags` by account/visibility. [useBookmarkEditor](src/features/illusts/use-bookmark-editor.ts) supplies the shared editor controller; saved tags and status come from Query. It waits for the initial metadata refresh, adopts only `is_registered` tags, and blocks writes after an initial read failure. Catalog failures leave manual editing available. Once initialized, background refresh preserves the known status, and idle editors adopt updated Query tags instead of retaining a separate saved baseline.

The editor's only transient selection is an accepted tag-write batch. [bookmark-tag-writer](src/features/illusts/bookmark-tag-writer.ts) serializes writes, coalesces subsequent selections, and rejects cache synchronization until the batch settles. A failure stops the batch, restores its last confirmed tags, retains encountered names for a manual retry, and never automatically replays queued writes. Idle synchronization also handles successful removal, so later edits cannot resurrect old tags. The writer captures the originating account/artwork command; it must not rebind queued edits to a newly selected account. Mutations share a busy key across entry points, bind cancellation to the account session, and guard submission and cache callbacks by generation. Accepted edits finish after popup dismissal or navigation within the same account; account changes cancel them even after their originating component unmounts. Post-save refresh failures remain read errors.

Cards retain the original one-click heart and hover chooser, with tags first and public/private shortcuts below. All chooser rows share centered icon/text alignment and omit submenu chevrons. ArrowUp/ArrowDown opens the chooser and ArrowRight on tags opens its nested editor. Delayed dismissal rechecks pointer/focus inside the heart, chooser, and nested editor; focused or clicked editors remain open across pointer movement. Outside press and Esc dismiss the editor while accepted saves continue. Stable tooltip/popover triggers preserve anchor position and nested focus restoration through loading, failures, and retries.

Card and viewer entry points use the same 288 px popover, controller, and checklist built with existing Input, Checkbox, Button, and ScrollArea primitives. The shell has no outer padding; aligned inner spacing belongs to the search header, checklist rows, artwork group, and status footer. The list has no vertical padding and a fixed five-row height. Artwork tags stay in their own labeled group, using text-only buttons with in-place selection styling and no reserved checkmark. Their names are excluded from account-tag rows. Search remains editable during reads and saves. Enter/the add row commits one normalized name explicitly, respects IME composition, and retains input when the action is blocked. Selection and creation wait for fresh metadata and conflicting status writes; search text alone never creates a bookmark. Reads do not dim controls or tint the search input. One search-header spinner appears after reads last 250 ms, and immediately for writes; no list skeletons or blocking overlay are used. Read errors and retry stay inside the fixed list region. The scoped viewport loads more suggestions at its bottom, fills an underfull first screen, pauses during search/reads/errors, and disconnects on close. Appending preserves scroll position, and a failed page retains loaded rows.

The Bookmark status footer is one Base UI Toggle Group with Not saved/Public/Private choices. One known choice stays pressed; selecting it again is a no-op. Arrow keys move focus and Enter/Space activates a choice. Its initial loading state replaces each label with a short skeleton in the same control layout, retaining localized dimensions and the normal track/caption. An initial read failure removes skeletons and leaves disabled, unselected choices beside the actionable error. Background refresh and accepted writes preserve the known selection. Public/Private writes omit tags to preserve the latest saved set; tag writes omit visibility. Explicit tag selection on an unsaved work creates a public bookmark by default, or the user can select Private first. Not saved removes the bookmark and optimistically clears tags, with shared-cache rollback on failure. Status changes wait for tag batches to settle, and tags pause during status writes. The popup stays open while its anchor remains mounted.

The viewer section is labeled My bookmark. Its stable outline trigger reads Bookmark for an unsaved work, or Public/Private for a saved work, with the same heart/magnet icons, fill, and color as cards. Cold reads show a skeleton within the reserved trigger footprint and one small tag placeholder. The body shows saved tags, no tags, or not saved as distinct states; background refresh is silent and read errors stay actionable without hiding known metadata. The open editor owns read feedback; closed details expose retry in the body. Collection tags navigate to the current account's matching bookmark partition, while artwork tags navigate to global search. Cards fetch metadata only when their chooser/editor opens. The pinned viewer footer contains download and Pixiv actions and the bookmark count; editing is available through My bookmark.

Own bookmark pages place section tabs and the left-aligned tag picker on separate rows above the full-width grid; the toolbar sticks to `[data-app-scroller]`. The 256 px picker popup opens with focus on itself, uses a fixed six-row region, has no outer/vertical list padding, and puts its flush search input and refresh button in the bottom row. Its scoped viewport uses the same pagination behavior as editor suggestions. Selected catalog rows use a soft primary tint, medium-weight name, and leading accent; neutral focus highlighting remains distinct. Names/counts form two columns with no trailing checkmark. The Base UI combobox filters loaded names, supports an IME-safe exact-name jump, and preserves an absent current tag. URL tag/visibility/page own navigation. Counts remain nullable in Query until supplied upstream and render as `0` in controls; loading and errors are represented separately. Upstream counts may lag and must not be summed into a total. Cold bookmark grids show at most six skeleton cards, fewer for known small counts, with the real card's text dimensions.

Successful mutations update known detail immediately, remember new names with unknown counts, refresh catalogs, and advance revisions only for bookmark lists whose membership may have changed. Each changed revision resets its cursor chain and visible page to page one; other lists become stale. No redundant navigation is issued for an already first-page URL. Route/filter, artwork, and account changes close editors, while equivalent URLs and a background page reset behind the same URL-selected viewer artwork preserve its editor. Card editors still close on pagination. Changing tags or visibility does not increase bookmark counts; optimism uses the latest cached artwork count. Empty filtered lists retain their tag selection and provide a return to all bookmarks.

Follow buttons use local optimism via `usePropSyncedState`, adopting fresh server props when no mutation is pending. Successful mutations invalidate affected lists through `useInvalidateIllustLists`. The helper marks them stale without immediate refetch storms; the next mount or return to a kept page refreshes them in the background. Non-list queries and lists that must not refresh opt out with `meta: SKIP_LIST_INVALIDATION`.

Settings' `applyView` mirrors adopted saves/resets/refetches into `CONFIG_QUERY_KEY`. Keep that path so consumers such as ranked-search page-size calculation immediately see settings changes. Restart and update flows use `pollUntil` for authoritative catch-up rather than relying only on an SSE edge.

## Events and downloads

`EventStreamProvider` opens EventSource while authenticated, closes it on logout, and exposes topic subscriptions. Use `useRefreshOnReconnect` to refetch after connection establishment/reconnection and `system.resync`. REST remains authoritative.

| Hook | Responsibility |
| --- | --- |
| `useTrackedJob` / `useIllustDownloadStatus` | One artwork's active or recent terminal job (and its progress) from the provider's store |
| `useDownloadCounts` | Global active/done counts from job events |
| `useDownloadActions` | Stable submit/cancel/remove/clear plus the tracked-job store; events drive resulting state |
| `useDownloadMutations` | The same actions plus the per-key error stash |
| `useDownloadsPage` | Instance-local server pagination; job events refetch, task events patch |
| `useIllustDownload` | Shared card/viewer enqueue, status, just-sent and error behavior |

`DownloadStateProvider` keeps tracked jobs in a `DownloadStateStore` with per-artwork subscriptions, so a progress tick re-renders only the controls showing that artwork. Read it through these hooks; don't put the job map back into context, which made every card in every kept page re-render on each tick. Event handling lives in the pure `applyDownloadEvent`.

Only `download.job.*` events update client job status. Task events update tasks, not a client-derived job aggregation. Use `ACTIVE_STATUSES` for in-flight status. Artwork progress is a byte ratio, indeterminate when any size is unknown; `DownloadsTable` job progress is count-weighted. Don't interchange them.

### Batch selection and submission

`IllustSelectionProvider` lives inside the account-keyed root layout. Each kept page owns a DOM-free `IllustSelectionStore` and registers a controller with its focus-return callback. Layout-effect registration is removed while the page is hidden and restored on reveal without resetting state. The shared action bar is a sibling of the main ScrollArea, anchored to the main panel's bottom-right corner below popup layers. Its measured height reserves scroll content and focus-scroll space; do not portal it to the window or attach it to the filter panel. Use equally sized compact buttons with consistent gaps; show the count in the selection status and keep the download label short. The bar provides select-all, download, and exit; there is no separate clear button.

Artwork card checkboxes enter selection mode; there is no selection control in the list header. The store's `toggleAll` action owns the selection toggle: any nonempty selection clears, while zero selection selects all. Deselect keeps the bar open, so the user can select all again; the close control exits, and deselecting the last card also exits. The select-all label stays short with its scope in the tooltip. All-select covers filtered works on the current numbered page or already loaded feed pages; loading more never adds selection automatically. Server-side list identities (including page, user, tab, and search/filter parameters) reset selection, while same-list filtering/refetch intersects it with the current results. Temporary loading/placeholder states disable edits without treating missing data as an empty result; only usable results prune the previous selection. Kept-page navigation preserves it. The selection hook exposes only selected IDs, mode, disabled state, and the card toggle handler.

Batch enqueue uses at most four workers and checks current tracked queued/running jobs before each submit. Each batch captures its list revision and owns that list's submit lock. Changing lists detaches the old lock and progress so the new list can be edited; the old batch continues but cannot clear the new batch's lock or adopt its results. Same-list filtering retains the batch and reconciles outcomes against the remaining visible IDs; an empty intersection or explicit exit prevents reopening selection. Successful/existing jobs leave the selection; visible failed submits remain selected for retry. Counts describe enqueue outcomes, not download completion. The shared download submit path coalesces in-flight calls per artwork and committed session; account changes revoke unsent batch work and prevent adopting old responses. Already dispatched requests and accepted downloads are not rolled back. Escape exits from artwork checkboxes while respecting text inputs and open popup layers. Card handlers pass the actual selection control to the hook, rather than inferring it from global focus. When selection ends with focus owned by the action bar (including blur caused by disabling the submit button), one layout effect returns focus with `preventScroll`, covering close, Escape, and successful submission without pulling the viewport to that card.

## Localization and errors

Read text in render paths using `const m = useMessages()` from `@/i18n`. It subscribes to locale changes. Module-level imports/evaluated UI text freeze the language; move UI constants into render or memoized work with correct dependencies. Dynamic message selection uses explicit static maps.

[Message conventions](src/i18n/messages/README.md) own naming and parameter rules: all four locales must have matching keys/parameters. Do not duplicate those rules in new message metadata keys.

Locale resolution has two stages. Before login, an existing Paraglide localStorage choice wins; on a first visit, navigator languages are prefix-matched (Traditional Chinese regions/Hant before generic Chinese, then Japanese/English). After auth, LocaleSync applies persisted `app.language`. Settings applies a language change synchronously without page reload or remount. Applying a language always updates the React locale context, even if storage already resolves to that language; compare the previous runtime locale before persisting so consumers receive the change.

`useApiErrorMessage` renders non-empty `kind=app` messages verbatim; otherwise it resolves upstream reason, then error code, then the message fallback. Validation details come from `fields`; expose request IDs for internal failures. Do not render raw upstream bodies.

Settings labels use explicit `useFieldText/useSectionTitle` maps. Missing translations fall back to the raw field key/section ID. Backend schema supplies structure and flags, not human-readable UI text.

## Shared UI patterns

- Compose classes with `cn(...)`, not template literals. Reuse Base UI/shadcn primitives, Material You tokens, root tooltips, and accessible control labels.
- Render Pixiv images with `PximgImage`. It rewrites to the same-origin proxy, shows the fallback underlay until the image has faded in after load/decode, then unmounts it (errors keep it). `className` styles the wrapper, not the inner image, and must size the box itself, since the fallback does not hold it open after reveal. `fit="cover"` suits thumbnails; `fit="contain"` suits the viewer. Use `onLoad(img)` for natural dimensions; don't force eager decode and defeat lazy loading.
- Don't use `backdrop-filter` (`backdrop-blur-*`) on repeated list items or on surfaces that float over scrolling artwork; use a solid or translucent fill. Each blurred element becomes its own compositor layer, and with hundreds of cards Chromium's layerization cost every frame made long feeds scroll at 15–30 fps on desktop. Singleton chrome away from the grid (settings header, transient overlays) may keep it.
- `IllustGrid` and `IllustCard` are memoized; keep card props stable (cached illust objects, a per-card `selected` flag, `useCallback` handlers). Don't subscribe every card to the router location or a frequently changing context: opening the viewer changes `?illust=`, and a per-card subscription re-renders whole grids. Per-artwork state goes through a keyed store (as downloads do), and location-dependent resets mount only while needed (`BookmarkNavigationReset`).
- Popup roots inside artwork cards mount on intent: the preview popover and bookmark chooser render their Base UI root after pointer-enter or focus on their trigger and unmount once closing completes. Across a long feed, always-mounted roots were most of the JS heap. Keep new per-card popups lazy the same way; the heart's error tooltip stays mounted because a detached trigger cost more render time than it saved.
- Artwork cards use `content-visibility:auto`, so off-screen cards skip style, layout and paint. Until a card first renders it reserves the height `IllustGrid` estimates from its width (`illust-grid-layout.ts`; keep it in sync with the card's padding and text block). This keeps every card in the DOM, so keep-alive scroll restoration, focus return, Tab order and popup anchors work as before. The grid is not virtualized; consider windowing only for feeds that measurably outgrow this.
- Numbered lists wrap results in `ListLoadingOverlay`, active on `query.isPlaceholderData`. This explains slow page steps while previous data remains visible. Cursor-walk skeletons take precedence. Cold settings/download loaders use `useDelayedFlag` to avoid flashes and premature empty states.
- Pipe list results through `useFilteredIllusts`; register `useFilterPanel` with filter rows, counts, and reset. Batch actions are independent of the filter panel: use `useIllustSelection` with the list identity, filtered IDs, readiness, and page/loaded scope. Pass its toggle handler and explicit mode/disabled state to `IllustGrid`; artwork cards provide the selection entry.
- New activity-bar panels use typed item hooks/payloads, a panel component, and registration in `ITEM_DEFS`. Export typed panel/data hooks from the barrel.
- Reuse `DownloadsTable`; its compact mode hides headers/size/actions.
- The page scroll root is the Base UI ScrollArea viewport tagged `data-app-scroller`, not `main` or window. Use shared scroll helpers for pagers, scroll-spy, and observers. New persistent scroll regions use ScrollArea with appropriate flex sizing; transient popups keep their scoped native bars.
- Use `src/lib/format.ts` for counts, bytes, and dates, preserving artwork source-timezone dates and locale-aware relative-time formatting.

## Desktop integration

Feature-detect the [desktop bridge](src/lib/desktop.ts); browser builds have none. The login page uses captured OAuth codes in desktop and manual callback/token entry in a browser. UpdateProvider maps its existing UI onto `window.pixivbiu.updates` instead of the core update endpoints.

The release-notes dialog accepts core Markdown and the HTML notes supplied by electron-updater's GitHub feed. Its renderer (`release-notes-markdown.tsx`) is a lazily loaded chunk, prefetched when the trigger is hovered or focused, because the Markdown/HTML pipeline was over a fifth of the main bundle; import it only through the dialog. Run `rehype-raw` before `rehype-sanitize` so both formats share the same styled React elements while scripts, event handlers, unsafe URLs and embedded SVG are removed by the default sanitization schema. Keep sanitization after HTML parsing.

Desktop restores an explicit set of UI preferences through `lib/preferences.ts` before dynamically importing App. Use `writePreference` for persisted UI writes; direct localStorage writes in desktop are memory-only. The shell owns a versioned, bounded file and validates every IPC request. Browser builds continue using localStorage. Paraglide’s locale cache is restored before its runtime initializes and is saved by LocaleProvider when applying language.

Keep the frontend interface aligned with [preload.ts](../desktop/src/preload.ts). Renderers use the stable `pixivbiu://core` origin, not the private sidecar port. Chrome flags come from the shell: absent flags fall back to framed/opaque. Use the existing drag/no-drag conventions for interactive controls. The [desktop guide](../desktop/README.md) owns protocol, IPC, window and release details.

`WindowLayout` wraps all routes and owns the Windows title-bar row plus the remaining content viewport (`data-window-content`). Route roots use `h-full`, not `h-svh`; `--window-content-top` and `--window-content-height` are the shared geometry contract. The application page scroller remains `[data-app-scroller]`. Windows uses the explicit top bar and main sidebar for dragging: `data-window-sidebar` opts that sidebar into `app-drag` and scopes its control exceptions. Other `app-drag` surfaces, including the activity rail, only activate in the macOS frameless shell. Native/HTML fullscreen removes reserved chrome, with read-only state from the optional `windowChrome` bridge and a DOM fullscreen fallback.

macOS keeps the invisible 44px top drag band without adding a toolbar or page padding. `desktop.css` limits automatic `no-drag` exceptions to controls inside `app-drag`, semantic headers/forms/navigation/toolbars/tab lists, and explicit `data-app-controls` groups; on Windows only the main sidebar gets automatic control exceptions. Mark a custom action row or settings form with `data-app-controls`; mark a custom interactive widget with `data-app-no-drag` (or `app-no-drag`) on either desktop platform. The group marker itself does not disable dragging in its empty space. Do not put these markers around artwork feeds or cards: ordinary content remains undeclared and clickable below the drag band, while artwork passing underneath the band must not change window dragging. Electron's native region calculation can include clipped, scrolled `no-drag` boxes; global declarations or explicit `app-region: none` resets reintroduce invisible holes. Shared portal surfaces, modal backdrops, scrollbars and resize handles have exceptions on both Windows and macOS so they receive pointer input over draggable sidebars. These rules are inactive in browser/Linux and in fullscreen.

Portal UI must respect the same content viewport. Shared Dialog CSS centers and bounds Windows popups below the caption strip; a dialog with its own scroll regions can retain `overflow-hidden`. Viewer height derives from `--window-content-height`. Anchored primitives consume `useWindowContentBoundary()` for Base UI collision handling; the measured rectangle updates as the content resizes. Windows selects disable viewport-based item alignment while the inset is present. Use these shared primitives for new floating UI rather than positioning directly against the entire window. Browser, Linux and macOS retain their normal collision policy.

## Behavioral checks

Run `bun test tests/bookmarks.test.ts` for tag normalization, membership-specific cursor invalidation, immediate-edit write ordering, coalescing, clearing, failure rollback, confirmed-selection reset after removal, protection of accepted writes during reset, and editor navigation across collection pagination resets. In addition to Biome/build, exercise the behavior touched by a UI change: account switches, bookmark card/viewer agreement and rollback, pagination versus filter changes, slow loading, SSE reconnect/resync, language changes without reload, image fallback/lazy loading, scroll-root behavior, and page keep-alive (switch sections and go Back/Forward, then check that state, scroll, and open popups behave and nothing refetches unexpectedly). For bridge changes, check both browser and native desktop paths. The build does not verify these interactions automatically.
