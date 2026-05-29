# PixivBiu v3

PixivBiu 的下一代大版本，采用 Go 实现，前后端分离同仓管理。

## 技术栈

- **Go** 1.26
- **Router**: [chi v5](https://github.com/go-chi/chi)
- **API 代码生成**: [oapi-codegen v2](https://github.com/oapi-codegen/oapi-codegen)
- **配置**: [koanf v2](https://github.com/knadh/koanf)
- **日志**: 标准库 `log/slog` + [go-chi/httplog v3](https://github.com/go-chi/httplog)（HTTP 请求日志，统一 ECS Schema）
- **动图编码**: [nativewebp](https://github.com/HugoSmits86/nativewebp)（纯 Go，零 cgo）

## 目录结构

```
.
├── api/              # OpenAPI 规范（openapi.yaml + paths/）
├── cmd/server/       # 服务入口
├── internal/
│   ├── api/          # 生成的 server + handler 实现
│   ├── config/       # 配置加载
│   ├── download/     # 下载管理器、worker、ugoira 编码
│   ├── inbox/        # 统一 pub-sub + SSE 分发
│   ├── pixiv/        # pixivgo 封装 + token 刷新
│   ├── server/       # chi 路由与中间件
│   └── state/        # token 持久化
├── usr/              # gitignore；settings.json / state.json / downloads.json
├── frontend/         # React 19 + Vite + TS + react-router 7 + shadcn/ui + Paraglide i18n
└── Makefile
```

## 快速开始

```bash
# 1. 安装依赖 + 安装 oapi-codegen 工具
go mod tidy
go get -tool github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest

# 2. 生成 API 代码
make gen-backend

# 3. 启动（首次无配置文件即可直接跑，全部用默认值）
make dev

# 4. 验证
curl -s http://localhost:8080/api/v1/health        # => {"status":"ok"}
curl -N http://localhost:8080/api/v1/events        # SSE 事件流
open  http://localhost:8080/docs                   # Scalar 交互式文档
```

## 当前功能

| 域 | 说明 |
|---|---|
| `/auth/*` | 浏览器内 Pixiv OAuth (PKCE) 登录；登出、状态查询；token 自动刷新；refresh_token 直登保留为高级入口；登录前先做连通性检测（连不上可设代理） |
| `/illusts/*`、`/users/*`、`/search/*` | Pixiv 只读浏览 + 书签/关注写入 |
| `/downloads` | 单图 / 多图 / 动图下载，JSON 持久化，断点重启恢复 |
| `/events` | SSE 统一消息流；`Last-Event-ID` 重连补齐，evict 时发 `system.resync` |

下载路径用 Go `text/template`（变量 `.Title`/`.Index`/`.UserName` 等，函数 `sanitize`/`pad`/`date`/`trunc`/`default`）。每段路径强制 sanitize、拒绝 `..`、按字节截断保留扩展名。同名文件按 ` (1)`/` (2)` 递增。动图支持 `webp | gif | none` 三档。

## 登录

登录前，引导页会先做一次 **Pixiv 连通性检测**：连得上就继续；连不上时会浮现一个代理输入框，当场实测，通过后记住（写入 `pixiv.proxy`），随后的登录与浏览都走这个代理。

连通性检测通过后，登录本身走 Pixiv OAuth (PKCE) 流程，全程在浏览器里完成：

1. 顶栏点头像 → **使用 Pixiv 账号登录**，会弹出 Pixiv 官方登录页（验证码 / 二次验证都由 Pixiv 自家处理）
2. **在弹窗里** 按 `F12` / `⌥⌘I` 打开 DevTools
3. 切到 **Network** 面板，勾选 **Preserve log / 持续记录**
4. 在 Network 顶部的 **Filter** 框输入 `callback?`
5. 在弹窗里用 Pixiv 账号完成登录（之后浏览器会停在空白 / 报错页，这是预期的）
6. 找到过滤出的那条 `callback?state=…&code=…` 请求 → 右键 → **Copy / 复制** → **Copy URL / 复制链接**
7. 粘到 PixivBiu 登录对话框里 → 完成

> 之所以要走 DevTools 取 code：Pixiv 的 OAuth 回调用的是 Android 自定义 URL scheme `pixiv://`，桌面浏览器无法跳转，code 不会出现在地址栏，只能从 Network 抓。

后端临时持有 PKCE `code_verifier`（仅内存、10 分钟 TTL、单次使用），换得的 refresh_token / access_token 写入 `usr/state.json`，后续靠它自动刷新。

> 已有 refresh_token 的老用户 / 自动化场景，可展开登录对话框里的「已经有 refresh token？」面板直接粘贴。`POST /auth/login {refresh_token}` 仍然可用。

## 配置

加载顺序：**内置默认值 → `./usr/settings.json` → 环境变量**（前缀 `PIXIVBIU_`，下划线映射为点）。env 仍然胜出。

`settings.json` 由程序自己管理，**不需要手编**：

| 操作 | 方式 |
|---|---|
| 读全部 effective + per-key source | `GET  /api/v1/config` |
| 字段元信息（min/max/enum/sensitive/restart/internal） | `GET  /api/v1/config/schema` |
| 部分更新（diff-only 写盘） | `PATCH /api/v1/config` body 形如 `{"download.max_concurrent": 8}` |
| 单 key / 全部回退到默认（运维设置除外） | `POST /api/v1/config/reset` body `{"keys":["..."]}` 或 `{"all":true}` |
| 重启进程以应用 restart 字段 | `POST /api/v1/config/restart` |

注意几个语义：

- **选择性热重载**——非 `restart`、非运维设置的字段 PATCH 后**立即生效**：`effective` 随之推进，运行中的服务热应用（日志级别、代理、下载模板/超时等）。
- **重启字段**——可 PATCH 的 `restart=true` 字段（`app.language`、`log.format`、`pixiv.bypass_sni`、`download.max_concurrent`）写盘后仍冻结在启动值，并列入 `GET /config` 的 `pending_restart`；调 `POST /api/v1/config/restart` 优雅排空并 re-exec 进程后生效（下载任务重启后自动恢复、SSE 自动重连，无损）。
- **运维设置**（`internal=true`：`server.*`、`pixiv.state_file`、`download.{referer,store_file}`、`inbox.*`）——只关乎程序运维、与使用体验无关，**运行时 API/界面不可改**：PATCH 与指定 key 的 reset 一律拒绝（400），`{"all":true}` reset 也会保留它们；设置界面里只读展示。改它们只能手动编辑 `settings.json`（或用 `PIXIVBIU_*` 环境变量），且改完需手动重启进程生效。
- **敏感字段**（如 `pixiv.proxy`）写盘是明文、`GET` 返回为 `***`；PATCH 收到 `"***"` 或 `""` 视为「保持原值」。
- **env 仍胜出**——被 env 锁定的字段 `sources` 标为 `env`，PATCH 写入文件但 `effective` 不变（无论冷热字段），直到 env 撤销。
- 文件路径用 `-config` 覆盖；默认 `./usr/settings.json`。

env 覆盖示例（开发期最常用的快捷开关）：

```bash
PIXIVBIU_SERVER_PORT=9090 make dev
PIXIVBIU_LOG_LEVEL=debug PIXIVBIU_LOG_FORMAT=json make dev
PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT=gif make dev
```

## 开发流程

- 改 `api/openapi.yaml` 或 `api/paths/*.yaml` 定义接口
- `make gen-backend` 重新生成 `internal/api/server.gen.go`
- 在 `internal/api/handler_*.go` 实现对应接口
- `make dev` 联调；前端类型 `make gen-frontend`（需要后端在跑）

## 可用命令

```
make help          # 查看全部
make gen-backend   # 生成后端 API 代码
make gen-frontend  # 生成前端 API 类型（需后端在跑）
make dev           # 运行服务
make build         # 构建二进制
make test          # 运行测试
make tidy          # 整理 go.mod
make fmt           # 格式化
make vet           # go vet
```
