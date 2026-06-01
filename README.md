中文 | [English](README_EN.md) | [日本語](README_JA.md)

# PixivBiu

一款不错的 Pixiv 辅助工具。

- **浏览**：完整客户端体验，作品、用户、排行，收藏与关注等
- **筛选**：快速筛选，如收藏数、浏览量、标签、类型等
- **下载**：原图下载，包括单图、多图、动图
- **桌面与服务器**：全平台支持，提供 Windows、macOS、Linux 程序包

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

## Development

构建与开发需要 `Go 1.26+`、`bun`、`make` 环境。

### Build from Source

```bash
git clone https://github.com/txperl/PixivBiu.git
cd PixivBiu

# 构建前端与后端
# 产出的 bin/pixivbiu 已将前端内嵌
make dist

# 执行
./bin/pixivbiu
```

### For Dev

开发时，可以 `make dev` 启动后端，然后 `cd frontend && bun run dev` 启动前端。

具体的项目架构与实现细节，可参见 [AGENTS.md](AGENTS.md) 文档。

## License

- [MIT](LICENSE)
