# Configuration & Environment Variables

Reference for core settings, CLI overrides, and runtime paths. For deployment examples see [Docker](DOCKER.md); for adding a setting see [Development](DEVELOPMENT.md#adding-or-changing-a-setting).

[Config structs and defaults](../internal/config/config.go) define keys, types, metadata, and defaults. The running authenticated `GET /api/v1/config/schema` exposes structural metadata for visible settings. Hidden settings remain documented below even though they are omitted from that schema.

## Configuration layers

Precedence, low to high:

```text
built-in defaults → settings.json → PIXIVBIU_* environment variables
```

Use the Settings page or `/api/v1/config/*` for runtime edits. Missing `settings.json` is valid: defaults and environment values are used until the first successful settings write creates the file. Desktop may seed it before boot.

The file contains nested JSON user overrides, not a complete config dump:

```json
{
  "download": {
    "output_dir": "./artwork",
    "ugoira": { "format": "gif" }
  }
}
```

Ordinary values equal to defaults are pruned when saving. An explicit `app.update.channel` is retained because its default can change with the build. All writes use atomic replacement. Manual edits are not automatically applied to running services: stop the process, edit, and restart. Do not use file edits as a concurrent alternative to the Settings API.

### Saved versus effective values

`GET /api/v1/config` returns:

| Field | Meaning |
| --- | --- |
| `file` | Persisted user overrides, with sensitive values masked |
| `effective` | Values active in the running process |
| `sources` | Origin of each effective dotted key: defaults, file, or env |
| `pending_restart` | Restart-required keys whose new layered value differs from the boot value |
| `schema_version` | Settings shape version |

A PATCH can save a value while an environment override keeps the effective value unchanged. Remove the environment override and relaunch the process to release it; changing a terminal's environment does not change an already-running process. For containers, recreate the container with the revised environment.

A hot setting takes effect after a successful API write. A restart-required setting stays at its boot value until restart. `POST /api/v1/config/restart` accepts with 202, drains and restarts the core; clients reconnect afterwards. Interrupted downloads are requeued, not resumed from partial HTTP byte ranges.

### Key-to-environment mapping

Uppercase the dotted key, replace dots with underscores, and prepend `PIXIVBIU_`. Underscores inside existing key segments are preserved:

- `download.max_concurrent` → `PIXIVBIU_DOWNLOAD_MAX_CONCURRENT`
- `download.ugoira.format` → `PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT`
- `server.timeouts.shutdown` → `PIXIVBIU_SERVER_TIMEOUTS_SHUTDOWN`

The resolver uses known schema keys to distinguish separators from literal underscores. Duration settings accept Go duration strings such as `15s`, `1m30s`, and `250ms`.

### Flags and reset behavior

| Flag | Behavior |
| --- | --- |
| restart | API writes persist now and apply after restart; pending changes appear in `pending_restart` |
| internal | API PATCH and keyed reset reject the key; change through file/env and restart; UI is read-only |
| sensitive | Stored in cleartext on disk, masked as `***` in API views; PATCH of `***` or an empty string is a no-op |
| advanced | De-prioritized/folded in the Settings UI |
| hidden | Omitted from the UI schema; remains accessible through API, file, and env |

A keyed reset removes that key's file override so env/defaults win. Reset-all preserves internal and hidden overrides. Hidden keys can be reset explicitly; internal keys cannot. Reset does not remove environment overrides.

To clear the saved proxy, use the Settings reset action or send `{"keys":["pixiv.proxy"]}` to `POST /api/v1/config/reset` after login. An empty proxy PATCH deliberately does not clear it. An env-set proxy remains active until removed from the process environment and the app is relaunched.

## Runtime paths

The core stays portable: it accepts path overrides but does not choose OS application directories. The Electron shell makes that choice.

| CLI option | Environment fallback | Default / semantics |
| --- | --- | --- |
| `-data-dir <path>` | `PIXIVBIU_DATA_DIR` | Executable directory; under `go run`, the process working directory |
| `-cache-dir <path>` | `PIXIVBIU_CACHE_DIR` | `usr/cache` under the data root; image files go in its `img` child |
| `-config <path>` | None | Without an explicit flag: `usr/settings.json` under the data root; explicit relative paths use launch CWD |
| `-open` / `-open=false` | `PIXIVBIU_APP_OPEN_BROWSER` through the config layer | Explicit flag overrides the layered `app.open_browser` value |
| `-h` | None | Display CLI help |

Non-empty data/cache flags win over their environment fallback. Relative data/cache overrides are made absolute against launch CWD once at startup. Absolute paths stay absolute.

| Runtime data | Default location |
| --- | --- |
| Settings | `<dataRoot>/usr/settings.json` |
| Auth tokens | `<dataRoot>/usr/state.json` |
| Download history | `<dataRoot>/usr/downloads.json` |
| Downloaded artwork | `<dataRoot>/downloads` |
| Image cache | `<cacheRoot>/img` |
| Slog output | stdout, unless `log.file` selects a file |

Relative `pixiv.state_file`, `download.store_file`, `log.file`, and `download.output_dir` values anchor to the data root. An explicit settings file does not move those other paths. Example: `./bin/pixivbiu -config ./usr/settings.json` reads repository settings but still defaults to `bin/usr/state.json` and `bin/downloads`; add `-data-dir .` to root everything in the launch directory.

Docker sets the data root to `/data` and downloads to `/downloads`. Desktop uses OS user-data, cache, and log directories, and seeds `~/Downloads/PixivBiu` on first run when possible. See [Desktop storage](../desktop/README.md#develop) for the shell's placement. Back up settings, token state, download history, and artwork separately from the regenerable image cache. Treat token state and proxy credentials as private.

## Settings reference

Defaults below are core defaults; Docker/Desktop overrides are documented in their guides. A setting's flags are independent (for example, hidden can also require restart).

## app

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_APP_LANGUAGE` | `auto` | `auto` / `en` / `zh-CN` / `zh-TW` / `ja` — UI language (resolved client-side; `auto` follows the browser) | — |
| `PIXIVBIU_APP_OPEN_BROWSER` | `true` | bool — open the web UI in the default browser at startup | restart |
| `PIXIVBIU_APP_UPDATE_ENABLED` | `true` | bool — auto-check GitHub Releases for a newer build at startup and every 3 hours thereafter | advanced |
| `PIXIVBIU_APP_UPDATE_CHANNEL` | build-derived | `stable` / `beta` / `alpha` — update channel; a cumulative maturity floor (beta also accepts rc+stable, alpha accepts everything). The default tracks the running build's maturity: a stable (or dev) build defaults to `stable`, a beta/rc build to `beta`, an alpha build to `alpha` — so a pre-release keeps receiving its line's pre-releases. Set this to override. | advanced |

## server

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_SERVER_HOST` | `127.0.0.1` | listen address (`0.0.0.0` to accept LAN/Docker connections) | restart, internal |
| `PIXIVBIU_SERVER_PORT` | `4001` | listen port (1–65535) | restart, internal |
| `PIXIVBIU_SERVER_PORT_FALLBACK` | `true` | bool — when the port is busy, fall back to the next free one | restart, internal |
| `PIXIVBIU_SERVER_TIMEOUTS_READ` | `15s` | duration — HTTP read timeout | restart, internal |
| `PIXIVBIU_SERVER_TIMEOUTS_WRITE` | `15s` | duration — HTTP write timeout | restart, internal |
| `PIXIVBIU_SERVER_TIMEOUTS_SHUTDOWN` | `10s` | duration — graceful-shutdown deadline | restart, internal |

## log

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` | advanced |
| `PIXIVBIU_LOG_FORMAT` | `text` | `text` / `json` | restart, advanced |
| `PIXIVBIU_LOG_FILE` | _(empty)_ | log file path; empty = stdout only. When set, slog is written to this size-capped, rotating file (10 MB × 3 backups, 30-day age) **instead of** stdout — teeing through a broken inherited stdout could SIGPIPE-kill the process. A relative path anchors to the data root. The desktop build points it at the OS logs dir (`app.getPath('logs')`). | restart, internal |

## pixiv

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_PIXIV_PROXY` | *(empty)* | HTTP/SOCKS proxy URL `scheme://host` (empty = direct) | sensitive |
| `PIXIVBIU_PIXIV_BYPASS_SNI` | `false` | bool — DoH + alternative SNI for the API (restricted networks only) | restart, hidden |
| `PIXIVBIU_PIXIV_STATE_FILE` | `./usr/state.json` | auth-token persistence path | restart, internal |

## download

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_DOWNLOAD_OUTPUT_DIR` | `./downloads` | output dir template (see [Path templates](#path-templates)); may be absolute | — |
| `PIXIVBIU_DOWNLOAD_FILE_TEMPLATE` | *(see below)* | single-file name template | — |
| `PIXIVBIU_DOWNLOAD_FILE_GROUP_TEMPLATE` | *(see below)* | multi-page file name template | — |
| `PIXIVBIU_DOWNLOAD_MAX_CONCURRENT` | `4` | worker-pool size (1–64) | restart |
| `PIXIVBIU_DOWNLOAD_HTTP_TIMEOUT` | `60s` | duration — per-download request timeout | — |
| `PIXIVBIU_DOWNLOAD_RETRY_MAX` | `2` | max retries per task (0–10) | advanced |
| `PIXIVBIU_DOWNLOAD_RETRY_INITIAL_BACKOFF` | `1s` | duration — first retry backoff (exponential, capped at 30s) | advanced |
| `PIXIVBIU_DOWNLOAD_REFERER` | `https://app-api.pixiv.net/` | `Referer` header sent with downloads | internal |
| `PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT` | `webp` | `webp` / `gif` / `none` (`none` keeps the original zip) | — |
| `PIXIVBIU_DOWNLOAD_STORE_FILE` | `./usr/downloads.json` | download-index persistence path | restart, internal |

## inbox (events / SSE)

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_INBOX_BUFFER_SIZE` | `200` | event ring buffer = `Last-Event-ID` replay window (1–100000) | restart, internal |
| `PIXIVBIU_INBOX_PROGRESS_THROTTLE` | `250ms` | duration — minimum interval between `download.task.progress` events | internal |
| `PIXIVBIU_INBOX_HEARTBEAT` | `15s` | duration — SSE `:keepalive` interval | internal |

## image (proxy / disk cache)

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_IMAGE_CACHE_MAX_SIZE_MB` | `2048` | `≥0` — on-disk cap (MiB; the setting name uses MB) for the `/api/v1/proxy/img` image cache (`0` = unlimited) | — |

## search

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_SEARCH_SAMPLE_PAGES` | `5` | `1`–`20` — page size for the bookmark-count / view-count illust-search sorts. Pixiv's popularity sort is Premium-only, so these sorts rank locally: each search page samples this many upstream pages (≈30 works each) and re-ranks them by bookmarks/views. Higher = more works per page, but more upstream requests (and latency) per page. | — |
| `PIXIVBIU_SEARCH_SAMPLE_CONCURRENCY` | `3` | `1`–`8` — how many of those upstream sample pages are fetched in parallel per bookmark/view-count search page (capped at `PAGES`). Higher cuts the per-page wait roughly proportionally; keep it conservative to avoid hammering Pixiv (rate limits). | — |

## Path templates

Download paths use Go `text/template`. The exact defaults are:

```text
output_dir          ./downloads
file_template       {{.IllustID}}_{{.Title | trunc 80}}{{.Ext}}
file_group_template {{.IllustID}}_{{.Title | trunc 80}}/{{.Index | pad 2}}{{.Ext}}
```

| Variable | Meaning |
| --- | --- |
| `.IllustID`, `.Title`, `.Type` | Artwork ID, sanitized title, and artwork type |
| `.UserID`, `.UserName` | Artist ID and sanitized name |
| `.CreatedAt`, `.Now` | Artwork creation time and job submission time; Now is shared across the job |
| `.Index` | Zero-based page index |
| `.Ext` | Output extension, including the leading dot |
| `.Home` | OS home directory |
| `.Root` | Runtime data root used by the download Manager |

Functions: `sanitize`, `pad`, `date`, `lower`, `upper`, `trunc`, and `default`. `trunc` counts Unicode runes, not bytes. Examples:

```text
output_dir          ./downloads/{{.Now | date "2006-01-02"}}
file_template       {{.UserID}}/{{.IllustID}}{{.Ext}}
file_group_template {{.UserID}}/{{.IllustID}}/{{.Index | pad 3}}{{.Ext}}
```

The date format is Go's reference date layout, not strftime. Dated directories are optional, not the default. `output_dir` may be absolute, including `{{.Home}}/Downloads/PixivBiu`; relative output roots use the data root. Both filename templates are always relative to the rendered output directory.

Every path segment is sanitized and clamped to at most 240 bytes, preserving normal file extensions. User titles/names cannot introduce subdirectories; literal template separators can. Existing or reserved filenames get a collision suffix rather than being deliberately overwritten.

Use the Settings naming preview to inspect results. Its API, `POST /api/v1/config/naming/preview`, writes nothing and uses a sample artwork with the current time. Omitted templates use live download settings. Parse/render errors appear per template in a 200 response's `fields`; the preview is an editor aid, while PATCH performs authoritative validation.
