package api

//go:generate go run ../../cmd/bundle -in ../../api/openapi.yaml -out ../../api/openapi.bundled.json
//go:generate go tool oapi-codegen -config ../../api/cfg.yaml ../../api/openapi.bundled.json
