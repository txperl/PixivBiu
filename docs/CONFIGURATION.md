# Configuration & Environment Variables

Full reference for every `PIXIVBIU_*` variable.

The settings file lives at `./usr/settings.json` by default (override with the `-config <path>` flag) and is managed by the running app (the web **Settings** page / `/api/v1/config/*`) — you normally never hand-edit it. Configuration is layered, low → high precedence:

```
built-in defaults  →  ./usr/settings.json  →  environment variables  (env wins)
```

**Data root (`-data-dir` / `PIXIVBIU_DATA_DIR`).** All runtime files — `usr/settings.json`, `usr/state.json`, `usr/downloads.json`, the `usr/cache/img/` image cache, and a **relative** `download.output_dir` (the `./downloads/<date>` default) — anchor to one base directory. By default that is the **executable's directory**, so the single binary keeps everything beside itself regardless of launch CWD (portable). Pass `-data-dir <path>` (or set `PIXIVBIU_DATA_DIR`; the flag wins) to relocate the whole tree at once — a relative value is made absolute once at startup. This is process-level, not a config key, so it isn't in the tables below. The Electron desktop build sets it to the OS user-data dir (`app.getPath('userData')`, e.g. `~/Library/Application Support/PixivBiu`) so state lives outside the read-only `.app` bundle. Note: an explicitly passed `-config <path>` and an **absolute** `download.output_dir` keep their own paths and are unaffected by the data root.

**Key ↔ env mapping.** Every setting has a dotted config key and a matching env var: uppercase the key, replace `.` with `_`, and prepend `PIXIVBIU_`. For example `download.ugoira.format` → `PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT`, `server.timeouts.shutdown` → `PIXIVBIU_SERVER_TIMEOUTS_SHUTDOWN`. Duration values accept Go duration strings (`15s`, `1m30s`, `250ms`). An env-set value also overrides the Settings UI: it's written to disk on a `PATCH` but the effective value stays pinned to the env until you unset it.

**Flags** (shown in the last column):

- **restart** — persisted but applied only after `POST /api/v1/config/restart` (or a process restart); shows up in `pending_restart`.
- **internal** — ops/program-only: not writable through the runtime API/UI (the Settings page renders it read-only, `PATCH`/keyed reset are rejected). Change it only via an env var or by hand-editing `settings.json`.
- **sensitive** — stored in cleartext on disk but masked as `***` in `GET /config`; a `PATCH` of `***` or `""` is a no-op.
- **advanced** — de-prioritised in the Settings UI (sorted/folded behind the "advanced" toggle).

## app

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_APP_LANGUAGE` | `auto` | `auto` / `en` / `zh-CN` / `ja` — UI language (resolved client-side; `auto` follows the browser) | — |
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

## pixiv

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_PIXIV_PROXY` | *(empty)* | HTTP/SOCKS proxy URL `scheme://host` (empty = direct) | sensitive |
| `PIXIVBIU_PIXIV_BYPASS_SNI` | `false` | bool — DoH + alternative SNI for the API (restricted networks only) | restart |
| `PIXIVBIU_PIXIV_STATE_FILE` | `./usr/state.json` | auth-token persistence path | restart, internal |

## download

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_DOWNLOAD_OUTPUT_DIR` | `./downloads/<date>` | output dir template (see [Path templates](#path-templates)); may be absolute | — |
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
| `PIXIVBIU_IMAGE_CACHE_MAX_SIZE_MB` | `2048` | `≥0` — on-disk cap (MB) for the `/api/v1/proxy/img` image cache (`0` = unlimited) | — |

## search

| Variable | Default | Values / notes | Flags |
|---|---|---|---|
| `PIXIVBIU_SEARCH_SAMPLE_PAGES` | `5` | `1`–`20` — page size for the bookmark-count / view-count illust-search sorts. Pixiv's popularity sort is Premium-only, so these sorts rank locally: each search page samples this many upstream pages (≈30 works each) and re-ranks them by bookmarks/views. Higher = more works per page, but more upstream requests (and latency) per page. | — |
| `PIXIVBIU_SEARCH_SAMPLE_CONCURRENCY` | `3` | `1`–`8` — how many of those upstream sample pages are fetched in parallel per bookmark/view-count search page (capped at `PAGES`). Higher cuts the per-page wait roughly proportionally; keep it conservative to avoid hammering Pixiv (rate limits). | — |

## Path templates

The three download templates are Go [`text/template`](https://pkg.go.dev/text/template) strings. Defaults:

```text
output_dir          ./downloads/{{.Now | date "2006-01-02"}}
file_template       {{.IllustID}}_{{.Title | trunc 80}}{{.Ext}}
file_group_template {{.IllustID}}_{{.Title | trunc 80}}/{{.Index | pad 2}}{{.Ext}}
```

- **Variables**: `.IllustID` `.Title` `.Type` `.UserID` `.UserName` `.CreatedAt` `.Now` `.Index` `.Ext` `.Home` `.Root`.
- **Functions**: `sanitize` `pad` `date` `lower` `upper` `trunc` `default` (`trunc` counts runes, not bytes).
- `output_dir` may be absolute (`/mnt/pixiv`, `{{.Home}}/Downloads`, `C:\pixiv`); a relative value is anchored to the executable's directory. `file_template` / `file_group_template` are always relative to `output_dir`. Every path segment is sanitised and clamped (≤240 bytes per filename, extension preserved); a literal `/` in the template is an explicit subdirectory.
