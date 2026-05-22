.PHONY: help gen-backend gen-frontend run build test tidy fmt vet clean

BIN       := bin/pixivbiu
PKG       := ./cmd/server
OAPI_CFG  := api/cfg.yaml
OAPI_SPEC := api/openapi.yaml

help:  ## Show this help
	@awk 'BEGIN{FS=":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

gen-backend:  ## Generate server code from the OpenAPI spec
	go tool oapi-codegen -config $(OAPI_CFG) $(OAPI_SPEC)

gen-frontend:  ## Generate frontend OpenAPI types (requires `make dev` running)
	cd frontend && bun run gen:api

dev:  ## Run the server
	go run $(PKG) -config ./usr/settings.json

build:  ## Build server binary
	CGO_ENABLED=0 go build -o $(BIN) $(PKG)

test:  ## Run tests
	go test ./...

tidy:  ## Tidy go.mod
	go mod tidy

fmt:  ## Format code
	go fmt ./...

vet:  ## Run go vet
	go vet ./...

clean:  ## Remove build artifacts
	rm -rf bin
