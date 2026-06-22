**中文** · [English](README_EN.md) · [日本語](README_JA.md)

# PixivBiu

[![Go](https://img.shields.io/github/go-mod/go-version/txperl/PixivBiu)](go.mod)
[![CI](https://img.shields.io/github/actions/workflow/status/txperl/PixivBiu/ci.yml?branch=master&label=CI)](https://github.com/txperl/PixivBiu/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/txperl/PixivBiu?sort=semver)](https://github.com/txperl/PixivBiu/releases)
[![License](https://img.shields.io/github/license/txperl/PixivBiu)](LICENSE)

PixivBiu，一款不错的 Pixiv 辅助工具。

- **浏览**：完整客户端体验，作品、用户、排行，收藏与关注等
- **筛选**：快速筛选，如收藏数、浏览量、标签、类型等
- **下载**：原图下载，包括单图、多图、动图
- **桌面与服务器**：全平台支持，提供 Windows、macOS、Linux 程序包

<!-- 截图占位：补充界面截图后取消注释 —— ![PixivBiu 界面](docs/screenshot.png) -->

## 使用

1. 前往 [Releases](https://github.com/txperl/PixivBiu/releases)，下载对应系统的程序包
2. 解压并运行 `pixivbiu` 文件
3. 在浏览器中打开 [http://127.0.0.1:4001](http://127.0.0.1:4001) 即可

## 配置

与功能、使用相关的配置，可以直接在设置页面中修改。

但请注意，有部分运维相关配置项，只能通过配置文件或环境变量修改。

常用环境变量：

| 变量                              | 作用                                         |
| --------------------------------- | -------------------------------------------- |
| `PIXIVBIU_SERVER_HOST`            | 监听地址（默认 `127.0.0.1`；`0.0.0.0` 对外） |
| `PIXIVBIU_SERVER_PORT`            | 监听端口（默认 `4001`）                      |
| `PIXIVBIU_LOG_LEVEL`              | 日志级别 `debug` / `info` / `warn` / `error` |
| `PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT` | 动图输出 `webp` / `gif` / `none`             |
| `PIXIVBIU_APP_LANGUAGE`           | 界面语言 `auto` / `en` / `zh-CN` / `ja`      |
| `PIXIVBIU_PIXIV_PROXY`            | 代理 URL（`scheme://host`，空 = 直连）       |

具体的配置说明，可参见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md) 文档。

## Docker

你也可以直接通过 Docker Image 运行 PixivBiu。

```bash
docker run -d --name pixivbiu -p 4001:4001 \
  -v pixivbiu-data:/data -v "$PWD/downloads:/downloads" \
  ghcr.io/txperl/pixivbiu:latest
```

亦或是通过 Docker Compose 运行。

```bash
# clone repo and move to
git clone https://github.com/txperl/PixivBiu.git
cd PixivBiu

# (host bind mount for downloads) make the dir writable by the container's uid
mkdir -p downloads && sudo chown 65532:65532 downloads

# start it
docker compose up -d
```

完整的 Docker 相关说明，可参见 [docs/DOCKER.md](docs/DOCKER.md) 文档。

## 开发

构建与开发需要 `Go 1.26+`、`bun`、`make` 环境。

### 从源码构建

```bash
git clone https://github.com/txperl/PixivBiu.git
cd PixivBiu

# 构建前端与后端
# 产出的 bin/pixivbiu 已将前端内嵌
make dist

# 执行
./bin/pixivbiu
```

### 本地开发

开发时，可以 `make dev` 启动后端，然后 `cd frontend && bun run dev` 启动前端。

具体的项目架构与实现细节，可参见 [AGENTS.md](AGENTS.md) 文档。

## Disclaimer & License

This project is intended for personal study and research only. Please comply with Pixiv's Terms of Service, respect creators' copyright, and refrain from any commercial or infringing use, or from redistributing downloaded works.

Released under the [MIT](LICENSE) License.
