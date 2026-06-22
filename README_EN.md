[中文](README.md) · **English** · [日本語](README_JA.md)

# PixivBiu

[![Go](https://img.shields.io/github/go-mod/go-version/txperl/PixivBiu)](go.mod)
[![CI](https://img.shields.io/github/actions/workflow/status/txperl/PixivBiu/ci.yml?branch=master&label=CI)](https://github.com/txperl/PixivBiu/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/txperl/PixivBiu?sort=semver)](https://github.com/txperl/PixivBiu/releases)
[![License](https://img.shields.io/github/license/txperl/PixivBiu)](LICENSE)

PixivBiu, a handy companion tool for Pixiv.

- **Browse** — a full client experience: illusts, users, rankings, bookmark & follow, and more
- **Filter** — quickly narrow lists by bookmarks, views, tags, type, and more
- **Download** — original-quality downloads of single images, multi-page works, and ugoira
- **Desktop & server** — all platforms, with Windows / macOS / Linux packages

<!-- Screenshot placeholder: uncomment once a UI screenshot is added — ![PixivBiu UI](docs/screenshot.png) -->

## Usage

1. Head to [Releases](https://github.com/txperl/PixivBiu/releases) and download the package for your system
2. Unzip and run the `pixivbiu` file
3. Open [http://127.0.0.1:4001](http://127.0.0.1:4001) in your browser

## Configuration

Feature and usage settings can be changed directly on the Settings page.

Note, however, that some ops-related settings can only be changed through the config file or environment variables.

Common environment variables:

| Variable                          | Purpose                                                   |
| --------------------------------- | --------------------------------------------------------- |
| `PIXIVBIU_SERVER_HOST`            | Listen address (default `127.0.0.1`; `0.0.0.0` to expose) |
| `PIXIVBIU_SERVER_PORT`            | Listen port (default `4001`)                              |
| `PIXIVBIU_LOG_LEVEL`              | Log level `debug` / `info` / `warn` / `error`             |
| `PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT` | Ugoira output `webp` / `gif` / `none`                     |
| `PIXIVBIU_APP_LANGUAGE`           | UI language `auto` / `en` / `zh-CN` / `ja`                |
| `PIXIVBIU_PIXIV_PROXY`            | Proxy URL (`scheme://host`, empty = direct)               |

For full configuration details, see [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Docker

You can also run PixivBiu straight from the Docker image.

```bash
docker run -d --name pixivbiu -p 4001:4001 \
  -v pixivbiu-data:/data -v "$PWD/downloads:/downloads" \
  ghcr.io/txperl/pixivbiu:latest
```

Or run it with Docker Compose.

```bash
# clone repo and move to
git clone https://github.com/txperl/PixivBiu.git
cd PixivBiu

# (host bind mount for downloads) make the dir writable by the container's uid
mkdir -p downloads && sudo chown 65532:65532 downloads

# start it
docker compose up -d
```

For the full Docker guide, see [docs/DOCKER.md](docs/DOCKER.md).

## Development

Building and developing requires `Go 1.26+`, `bun`, and `make`.

### Build from Source

```bash
git clone https://github.com/txperl/PixivBiu.git
cd PixivBiu

# build frontend + backend
# the resulting bin/pixivbiu has the frontend embedded
make dist

# run
./bin/pixivbiu
```

### Local Development

For development, start the backend with `make dev`, then the frontend with `cd frontend && bun run dev`.

For project architecture and implementation details, see [AGENTS.md](AGENTS.md).

## Disclaimer & License

This project is intended for personal study and research only. Please comply with Pixiv's Terms of Service, respect creators' copyright, and refrain from any commercial or infringing use, or from redistributing downloaded works.

Released under the [MIT](LICENSE) License.
