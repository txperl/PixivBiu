# syntax=docker/dockerfile:1
#
# Multi-stage build for PixivBiu — a single self-contained Go binary with the
# React SPA baked in via go:embed. Three stages:
#   1. web   — build the SPA with bun (arch-independent; built once, natively)
#   2. build — cross-compile the Go binary + healthcheck for the target arch
#   3. final — copy the static binaries into a distroless, non-root runtime
#
# The web/build stages pin to $BUILDPLATFORM and Go cross-compiles via
# GOOS/GOARCH, so a multi-arch `buildx` build never pays for QEMU emulation.
# For a plain single-arch `docker build`/`compose build` these resolve to the
# host arch, making the cross-compile a no-op.

# --- Stage 1: build the SPA -------------------------------------------------
FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS web
WORKDIR /src/frontend
# Cache dependencies as their own layer. --ignore-scripts skips the paraglide
# `postinstall` (it needs src/, which isn't copied yet); `bun run build` runs
# `paraglide:compile` itself, so nothing is lost.
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY frontend/ ./
# vite.config.ts emits to ../internal/web/dist (i.e. /src/internal/web/dist).
RUN bun run build

# --- Stage 2: compile the Go binaries ---------------------------------------
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
# Bring in the built SPA so //go:embed all:dist bakes real assets into the binary.
COPY --from=web /src/internal/web/dist ./internal/web/dist

ARG VERSION=docker
ARG TARGETOS
ARG TARGETARCH
# CGO_ENABLED=0 → fully static, portable binary. -buildvcs=false because the
# build context excludes .git (see .dockerignore), so VCS stamping would error.
# Both binaries build in one layer; they share the warm module cache.
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
      go build -trimpath -buildvcs=false \
        -ldflags "-s -w -X main.version=${VERSION}" -o /out/pixivbiu ./cmd/server \
 && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
      go build -trimpath -buildvcs=false -ldflags "-s -w" -o /out/healthcheck ./cmd/healthcheck

# Pre-create the runtime dirs owned by the distroless non-root uid (65532) so a
# freshly-initialised named volume inherits writable ownership from the image.
RUN mkdir -p /out/data/usr/cache/img /out/downloads \
 && chown -R 65532:65532 /out/data /out/downloads

# --- Stage 3: minimal runtime -----------------------------------------------
FROM gcr.io/distroless/static:nonroot
LABEL org.opencontainers.image.source="https://github.com/txperl/PixivBiu" \
      org.opencontainers.image.description="Pixiv artwork browsing, searching, and downloading tool" \
      org.opencontainers.image.licenses="MIT"

COPY --from=build /out/pixivbiu /pixivbiu
COPY --from=build /out/healthcheck /healthcheck
COPY --from=build --chown=65532:65532 /out/data /data
COPY --from=build --chown=65532:65532 /out/downloads /downloads

# Container-appropriate config. Overrides of internal/config/config.go defaults:
# host 127.0.0.1→0.0.0.0, port_fallback true→false, open_browser true→false, and
# output_dir → the split /downloads volume (no date subfolder). DATA_DIR roots all
# state under /data; PORT restates the default so the server and /healthcheck share
# one declared value.
ENV PIXIVBIU_SERVER_HOST=0.0.0.0 \
    PIXIVBIU_SERVER_PORT=4001 \
    PIXIVBIU_SERVER_PORT_FALLBACK=false \
    PIXIVBIU_DATA_DIR=/data \
    PIXIVBIU_DOWNLOAD_OUTPUT_DIR=/downloads \
    PIXIVBIU_APP_OPEN_BROWSER=false

EXPOSE 4001
VOLUME ["/data", "/downloads"]
USER nonroot

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/healthcheck"]

ENTRYPOINT ["/pixivbiu"]
