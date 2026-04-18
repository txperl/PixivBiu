# PixivBiu v3

PixivBiu 的下一代大版本，采用 Go 实现，前后端分离同仓管理。

## 技术栈

- **Go** 1.26
- **Router**: [chi v5](https://github.com/go-chi/chi)
- **API 代码生成**: [oapi-codegen v2](https://github.com/oapi-codegen/oapi-codegen)
- **配置**: [koanf v2](https://github.com/knadh/koanf)
- **日志**: 标准库 `log/slog`

## 目录结构

```
.
├── api/              # OpenAPI 规范 + 代码生成配置
├── cmd/server/       # 服务入口
├── internal/
│   ├── api/          # 生成的 server + handler 实现
│   ├── config/       # 配置加载
│   └── server/       # chi 路由与中间件
├── frontend/         # 前端占位
├── config.example.yaml
└── Makefile
```

## 快速开始

```bash
# 1. 安装依赖 + 安装 oapi-codegen 工具
go mod tidy
go get -tool github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest

# 2. 生成 API 代码
make gen

# 3. 复制配置并启动
cp config.example.yaml config.yaml
make run

# 4. 验证
curl -s http://localhost:8080/api/v1/health
# => {"status":"ok"}
```

## 配置

默认值 → `config.yaml` → 环境变量（前缀 `PIXIVBIU_`，下划线映射为点）依次覆盖。

```bash
PIXIVBIU_SERVER_PORT=9090 make run
PIXIVBIU_LOG_LEVEL=debug PIXIVBIU_LOG_FORMAT=json make run
```

## 开发流程

- 修改 `api/openapi.yaml` 定义接口
- `make gen` 重新生成 `internal/api/server.gen.go`
- 在 `internal/api/handler.go` 实现新接口
- `make run` 联调

## 可用命令

```
make help   # 查看全部
make gen    # 生成 API 代码
make run    # 运行服务
make build  # 构建二进制
make test   # 运行测试
make tidy   # 整理 go.mod
make fmt    # 格式化
make vet    # go vet
```
