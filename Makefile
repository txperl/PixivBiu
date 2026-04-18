.PHONY: help gen run build test tidy fmt vet clean

BIN          := bin/pixivbiu
PKG          := ./cmd/server
OAPI_CFG     := api/cfg.yaml
OAPI_SPEC    := api/openapi.yaml
OAPI_BUNDLED := api/openapi.bundled.json

help:  ## Show this help
	@awk 'BEGIN{FS=":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

bundle:  ## Resolve $refs in the OpenAPI spec into a single file
	go run ./cmd/bundle -in $(OAPI_SPEC) -out $(OAPI_BUNDLED)

gen: bundle  ## Generate server code from the bundled OpenAPI spec
	go tool oapi-codegen -config $(OAPI_CFG) $(OAPI_BUNDLED)

run:  ## Run the server
	go run $(PKG) -config ./config.yaml

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
