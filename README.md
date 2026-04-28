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
├── usr/              # gitignore；state.json / downloads.json
├── frontend/         # React 19 + Vite + TS + react-router 7 + shadcn/ui + Paraglide i18n
├── config.example.yaml
└── Makefile
```

## 快速开始

```bash
# 1. 安装依赖 + 安装 oapi-codegen 工具
go mod tidy
go get -tool github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest

# 2. 生成 API 代码
make gen-backend

# 3. 复制配置并启动
cp config.example.yaml config.yaml
make dev

# 4. 验证
curl -s http://localhost:8080/api/v1/health        # => {"status":"ok"}
curl -N http://localhost:8080/api/v1/events        # SSE 事件流
open  http://localhost:8080/docs                   # Scalar 交互式文档
```

## 当前功能

| 域 | 说明 |
|---|---|
| `/auth/*` | refresh_token 登录、登出、状态查询；token 自动刷新 |
| `/illusts/*`、`/users/*`、`/search/*` | Pixiv 只读浏览 + 书签/关注写入 |
| `/downloads` | 单图 / 多图 / 动图下载，JSON 持久化，断点重启恢复 |
| `/events` | SSE 统一消息流；`Last-Event-ID` 重连补齐，evict 时发 `system.resync` |

下载路径用 Go `text/template`（变量 `.Title`/`.Index`/`.UserName` 等，函数 `sanitize`/`pad`/`date`/`trunc`/`default`）。每段路径强制 sanitize、拒绝 `..`、按字节截断保留扩展名。动图支持 `webp | gif | none` 三档。

## 配置

默认值 → `config.yaml` → 环境变量（前缀 `PIXIVBIU_`，下划线映射为点）依次覆盖。

```bash
PIXIVBIU_SERVER_PORT=9090 make dev
PIXIVBIU_LOG_LEVEL=debug PIXIVBIU_LOG_FORMAT=json make dev
PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT=gif make dev
```

完整字段见 [`config.example.yaml`](config.example.yaml)。

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
