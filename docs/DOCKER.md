# Docker Deployment

Run the embedded SPA and Go core in one container. Persistent state and artwork live in volumes. Published images support Linux amd64 and arm64:

```text
ghcr.io/txperl/pixivbiu:latest     # moving stable tag
ghcr.io/txperl/pixivbiu:3.0.0      # example explicit version; choose an existing release
```

For configuration details see [Configuration](CONFIGURATION.md); image publishing is part of the [core release train](RELEASE.md).

## Quick start (Docker Compose)

Install Docker with the Compose plugin, clone the repository, and run commands from its root. The examples use a POSIX shell.

On a Linux host, prepare the downloads bind mount for the container's uid:

```sh
mkdir -p downloads
sudo chown 65532:65532 downloads
docker compose up -d
```

Open `http://localhost:4001` in a browser. Docker Desktop manages filesystem sharing differently; ensure the shared folder is writable if downloads fail.

The supplied [docker-compose.yml](../docker-compose.yml) publishes `4001:4001` on host interfaces. For local-only access, change its port mapping to `127.0.0.1:4001:4001`. The app uses one shared Pixiv session, not per-browser accounts. Remote deployments need network or reverse-proxy access control.

### Build from source

The Compose file's `build` section is commented out. Uncomment it first, then run:

```sh
docker compose up -d --build
```

Without an enabled `build` configuration, `--build` does not turn the image-only service into a source build. For an independent local image build:

```sh
docker build --build-arg VERSION=docker -t pixivbiu:local .
```

That image is separate from the Compose service until its `image` is changed to `pixivbiu:local`. The Dockerfile builds the frontend and core; no host Go/Bun installation is needed for that build.

## Quick start (docker run)

As an alternative to Compose, with the downloads directory prepared as above:

```sh
docker run -d --name pixivbiu --restart unless-stopped \
  -p 127.0.0.1:4001:4001 \
  -v pixivbiu-data:/data \
  -v "$PWD/downloads:/downloads" \
  ghcr.io/txperl/pixivbiu:latest
```

Proxy configuration is optional and depends on the host's route to Pixiv. Add the environment option described below before the image name when needed.

## Volumes

| Mount | Holds | Typical storage |
| --- | --- | --- |
| `/data` | `usr/settings.json`, `usr/state.json` (tokens), `usr/downloads.json`, `usr/cache/img` | Named volume |
| `/downloads` | Downloaded artwork; no default date subdirectory | Host bind mount |

The data volume preserves settings, login, and download history. Losing it does not delete files in the separate downloads mount, but the app loses its index and session. The image cache can be regenerated. Custom absolute paths need their own mounts; paths left in the writable container layer disappear on replacement.

### Non-root permissions

The image runs as uid 65532 (distroless nonroot). A new named volume inherits the image directory's ownership. An existing volume retains its existing contents and permissions; it may need repair if created by a different image/user.

A host bind mount keeps host permissions. On Linux, give uid 65532 write access to the dedicated downloads directory; don't recursively change unrelated host directories. As an alternative, use a named volume for downloads: replace `./downloads:/downloads` with `pixivbiu-downloads:/downloads` and declare that volume in Compose.

Distroless has no shell or package manager. Use host tools or a temporary helper container for volume maintenance; `docker exec ... sh` will not work.

## Configuration

Settings are managed in the UI/API, with `PIXIVBIU_*` environment variables taking precedence. The image supplies these overrides:

| Variable | Image value | Meaning |
| --- | --- | --- |
| `PIXIVBIU_SERVER_HOST` | `0.0.0.0` | Listen inside the container on all interfaces |
| `PIXIVBIU_SERVER_PORT` | `4001` | Container port; update the mapping if changed |
| `PIXIVBIU_SERVER_PORT_FALLBACK` | `false` | Fail if the selected port cannot bind |
| `PIXIVBIU_DATA_DIR` | `/data` | State root |
| `PIXIVBIU_DOWNLOAD_OUTPUT_DIR` | `/downloads` | Artwork mount |
| `PIXIVBIU_APP_OPEN_BROWSER` | `false` | Headless startup |

Environment settings remain effective even if a different value is saved in the UI. This includes the image's download output directory. To change it, override the environment and mount that destination. Recreate containers after changing their environment; a core-only restart does not replace container env.

### Proxy to reach Pixiv

If the connectivity step cannot reach Pixiv and your network requires a proxy, set `PIXIVBIU_PIXIV_PROXY` to a URL such as `http://host.docker.internal:7890`. For Compose, edit the existing environment entry; for docker run, add `-e PIXIVBIU_PIXIV_PROXY=http://host.docker.internal:7890`.

- Docker Desktop provides `host.docker.internal` for reaching the host.
- On Linux, enable the Compose `extra_hosts` entry, or add `--add-host=host.docker.internal:host-gateway` to docker run.
- The proxy must listen on an address reachable from the container. A host proxy bound only to loopback may need its LAN-access option enabled and appropriate firewall permissions.
- `127.0.0.1` inside the container refers to the container, not the host.

When direct connectivity works, leave the proxy empty. To remove a proxy saved through the UI, use its reset action; see [sensitive reset behavior](CONFIGURATION.md#flags-and-reset-behavior).

## Updating

Replace the container image to update:

```sh
docker compose pull
docker compose up -d
```

For a pinned image version, change the Compose tag first. For docker run, stop/remove the old container and recreate it using the same mounts and desired image. Back up state before an upgrade that may change persisted data.

The core has no container-specific guard making self-update a no-op. A release build can still offer an in-app update, but replacing its executable may fail under the image's permissions and would not update the declared image. Use container replacement. Builds stamped `docker` are treated as development versions and do not offer installable updates.

To return to an older version, select that image explicitly and recreate the container. Automatic rollback of application state is not provided; use a compatible backup if the older version cannot read the current state.

## Backup and restore

Stop the service before taking a consistent backup. Preserve the data volume's `usr/settings.json`, `usr/state.json`, and `usr/downloads.json`, plus the separate downloads mount. Cache files are optional. Keep the same download paths on restore because the index records file paths.

The following Linux/POSIX-shell example follows Docker's [volume backup and restore pattern](https://docs.docker.com/engine/storage/volumes/#back-up-restore-or-migrate-data-volumes). It uses a temporary BusyBox container for tar because the application image has no shell, refers to the supplied container name `pixivbiu`, and includes the cache:

```sh
docker compose stop
mkdir -p backup
docker run --rm --volumes-from pixivbiu:ro \
  -v "$PWD/backup:/backup" busybox:1.37 \
  tar -czf /backup/pixivbiu-data.tgz -C /data usr
docker run --rm --volumes-from pixivbiu:ro \
  -v "$PWD/backup:/backup" busybox:1.37 \
  tar -czf /backup/pixivbiu-downloads.tgz -C /downloads .
docker compose start
```

Protect these archives: they contain the Pixiv session and may contain proxy credentials. Copy them off the deployment host as appropriate.

To restore, create a stopped container with empty destination mounts using the same Compose layout (`docker compose create`), or stop the existing service. For existing populated mounts, first make a backup and empty the intended destinations so stale files are not mixed into the restored state. Then:

```sh
docker run --rm --volumes-from pixivbiu \
  -v "$PWD/backup:/backup:ro" busybox:1.37 \
  tar -xzf /backup/pixivbiu-data.tgz -C /data
docker run --rm --volumes-from pixivbiu \
  -v "$PWD/backup:/backup:ro" busybox:1.37 \
  tar -xzf /backup/pixivbiu-downloads.tgz -C /downloads
docker compose start
```

The helper runs as root to preserve archive ownership. Check that the restored directories are writable by uid 65532, then verify health, login, history, and artwork paths. Do not use `docker compose down -v` during routine updates: it removes named volumes.

## Health

The image's dedicated healthcheck binary probes `GET /api/v1/health`:

```sh
docker inspect --format '{{.State.Health.Status}}' pixivbiu
docker compose logs --tail=100 pixivbiu
```

Health confirms core HTTP availability, not Pixiv connectivity or authentication. The healthcheck executable ships only in Docker, not in the portable archives.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Downloads fail with permission denied | Bind-mount ownership/access for uid 65532; free space and destination path |
| UI opens but Pixiv cannot be reached | Proxy host address, Linux host-gateway entry, proxy listening interface |
| Saved setting does not take effect | Container env overrides and `pending_restart` |
| Events stop behind a reverse proxy | Disable response buffering for SSE and allow long-lived connections |
| Container is unhealthy | Startup logs, port/env consistency, settings validity and mount permissions |
| Source changes are absent | Enable Compose build config and rebuild; pulling uses the published image |
