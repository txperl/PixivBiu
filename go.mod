module github.com/txperl/PixivBiu

go 1.26.1

toolchain go1.26.9

require (
	aead.dev/minisign v0.2.0
	github.com/HugoSmits86/nativewebp v1.2.1
	github.com/getkin/kin-openapi v0.149.0
	github.com/go-chi/chi/v5 v5.3.0
	github.com/go-chi/httplog/v3 v3.3.0
	github.com/go-viper/mapstructure/v2 v2.5.0
	github.com/knadh/koanf/providers/confmap v1.0.0
	github.com/knadh/koanf/providers/env v1.1.0
	github.com/knadh/koanf/v2 v2.3.4
	github.com/minio/selfupdate v0.6.0
	github.com/oapi-codegen/runtime v1.4.0
	github.com/txperl/pixivgo v0.1.2
	golang.org/x/mod v0.40.0
	golang.org/x/sync v0.22.0
	golang.org/x/sys v0.47.0
	gopkg.in/natefinch/lumberjack.v2 v2.2.1
)

require (
	github.com/apapsch/go-jsonmerge/v2 v2.0.0 // indirect
	github.com/dprotaso/go-yit v0.0.0-20220510233725-9ba8df137936 // indirect
	github.com/fsnotify/fsnotify v1.9.0 // indirect
	github.com/go-openapi/jsonpointer v0.22.5 // indirect
	github.com/go-openapi/swag/jsonname v0.25.5 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/knadh/koanf/maps v0.1.2 // indirect
	github.com/mitchellh/copystructure v1.2.0 // indirect
	github.com/mitchellh/reflectwalk v1.0.2 // indirect
	github.com/oapi-codegen/oapi-codegen/v2 v2.7.1 // indirect
	github.com/oasdiff/yaml v0.1.1 // indirect
	github.com/oasdiff/yaml3 v0.0.14 // indirect
	github.com/santhosh-tekuri/jsonschema/v6 v6.0.3 // indirect
	github.com/speakeasy-api/jsonpath v0.6.3 // indirect
	github.com/speakeasy-api/openapi v1.19.2 // indirect
	github.com/vmware-labs/yaml-jsonpath v0.3.2 // indirect
	go.yaml.in/yaml/v3 v3.0.4 // indirect
	golang.org/x/crypto v0.56.0 // indirect
	golang.org/x/image v0.45.0 // indirect
	golang.org/x/telemetry v0.0.0-20260811182544-a038080d80e5 // indirect
	golang.org/x/text v0.41.0 // indirect
	golang.org/x/tools v0.49.0 // indirect
	golang.org/x/vuln v1.5.0 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

tool (
	github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen
	golang.org/x/vuln/cmd/govulncheck
)
