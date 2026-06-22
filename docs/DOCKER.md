# Docker Deployment

PixivBiu ships as a single self-contained binary (the React SPA is embedded), so
the container image is small and stateless — all persistent data lives in mounted
volumes. Pre-built **multi-arch images (linux/amd64, linux/arm64)** are published to
GitHub Container Registry on every release:

```
ghcr.io/txperl/pixivbiu:latest      # latest stable
ghcr.io/txperl/pixivbiu:3.0.0       # a specific version
```

## Quick start (Docker Compose)

```bash
# 1. (host bind mount for downloads) make the dir writable by the container's uid
mkdir -p downloads && sudo chown 65532:65532 downloads

# 2. start it
docker compose up -d

# 3. open the UI
open http://localhost:4001
```

`docker-compose.yml` lives at the repo root. To build the image locally from source
instead of pulling it, uncomment the `build:` block (or run `docker compose up -d --build`).

## Quick start (docker run)

```bash
docker run -d --name pixivbiu \
  -p 4001:4001 \
  -v pixivbiu-data:/data \
  -v "$PWD/downloads:/downloads" \
  -e PIXIVBIU_PIXIV_PROXY="http://host.docker.internal:7890" \
  ghcr.io/txperl/pixivbiu:latest
```

## Volumes

| Mount        | Holds                                                                                          | Recommended     |
| ------------ | ---------------------------------------------------------------------------------------------- | --------------- |
| `/data`      | `usr/settings.json`, `usr/state.json` (**auth token**), `usr/downloads.json`, `usr/cache/img/` | named volume    |
| `/downloads` | downloaded artwork (`/downloads/<date>/…`)                                                     | host bind mount |

`/data` is the single runtime root (set via `PIXIVBIU_DATA_DIR`); losing it means
re-logging in and re-downloading. Back it up to preserve your session.

### Non-root permissions (important)

The container runs as a **non-root user, uid `65532`** (distroless `nonroot`).

- A **named volume** (e.g. `pixivbiu-data`) "just works" — Docker initialises its
  ownership from the image.
- A **host bind mount** (e.g. `./downloads`) keeps the host directory's ownership,
  so it must be writable by uid `65532`:
  ```bash
  mkdir -p downloads && sudo chown 65532:65532 downloads
  ```
  Prefer to avoid that? Use a named volume for downloads too — replace
  `./downloads:/downloads` with `pixivbiu-downloads:/downloads` and declare it under
  `volumes:`.

## Configuration

Everything is configured via `PIXIVBIU_*` environment variables — see
[CONFIGURATION.md](CONFIGURATION.md) for the full list. The image already sets the
container-appropriate defaults:

| Variable                        | Image default                              | Notes                                   |
| ------------------------------- | ------------------------------------------ | --------------------------------------- |
| `PIXIVBIU_SERVER_HOST`          | `0.0.0.0`                                  | listen on all interfaces (vs. loopback) |
| `PIXIVBIU_SERVER_PORT`          | `4001`                                     | change → also remap `-p`                |
| `PIXIVBIU_SERVER_PORT_FALLBACK` | `false`                                    | fail loud on a busy port                |
| `PIXIVBIU_DATA_DIR`             | `/data`                                    | runtime root                            |
| `PIXIVBIU_DOWNLOAD_OUTPUT_DIR`  | `/downloads`                               | downloads volume root                   |
| `PIXIVBIU_APP_OPEN_BROWSER`     | `false`                                    | headless                                |

Commonly tuned at runtime: `PIXIVBIU_PIXIV_PROXY`, `PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT`,
`PIXIVBIU_LOG_LEVEL`, `PIXIVBIU_APP_LANGUAGE`.

### Proxy to reach Pixiv

Pixiv is typically unreachable without a proxy. Point `PIXIVBIU_PIXIV_PROXY` at one
(`scheme://host:port`):

- **Docker Desktop (macOS/Windows):** `http://host.docker.internal:7890` works out of the box.
- **Linux:** add `--add-host=host.docker.internal:host-gateway` (or the Compose
  `extra_hosts` entry, already stubbed in `docker-compose.yml`) so the hostname resolves.

## Updating

Update by pulling a newer image, not via the in-app updater:

```bash
docker compose pull && docker compose up -d
```

The in-app **self-update is a no-op inside Docker** by design — applying it would
rewrite the read-only, ephemeral binary. The update _check_ (banner) still works, so
you may see an "update available" hint; ignore it and pull the image instead.
(Locally built images are stamped with the version `docker`, which can make that
banner always appear — cosmetic only.)

## Health

The image defines a `HEALTHCHECK` that probes `GET /api/v1/health`:

```bash
docker inspect --format '{{.State.Health.Status}}' pixivbiu   # => healthy
```
