package config

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/go-viper/mapstructure/v2"
	"github.com/knadh/koanf/providers/confmap"
	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/v2"
)

const envPrefix = "PIXIVBIU_"

// SchemaVersion bumps when the shape of settings.json changes in a way
// that older overrides can't be applied cleanly. The API surfaces it so
// the frontend can warn / migrate.
const SchemaVersion = "1"

type Config struct {
	App      AppConfig      `koanf:"app"      cfg:"category=app,desc=应用通用设置"`
	Server   ServerConfig   `koanf:"server"   cfg:"category=server,desc=HTTP 服务器设置"`
	Log      LogConfig      `koanf:"log"      cfg:"category=log,desc=日志输出设置"`
	Pixiv    PixivConfig    `koanf:"pixiv"    cfg:"category=pixiv,desc=Pixiv 上游与认证设置"`
	Download DownloadConfig `koanf:"download" cfg:"category=download,desc=下载行为与模板"`
	Inbox    InboxConfig    `koanf:"inbox"    cfg:"category=inbox,desc=事件总线 / SSE"`
}

// AppConfig holds settings that don't belong to any single subsystem.
// language drives both the backend (startup banner + lifecycle logs) and
// the frontend UI — the frontend fetches the resolved value from /i18n
// and mirrors it, so the two never disagree.
type AppConfig struct {
	Language string `koanf:"language" cfg:"desc=应用界面与日志统一语言（auto = 跟随系统）,enum=auto|en|zh-CN|ja,restart=true"`
}

type ServerConfig struct {
	Host     string         `koanf:"host"     cfg:"desc=监听地址（0.0.0.0 接受所有）,restart=true,internal=true"`
	Port     int            `koanf:"port"     cfg:"desc=监听端口,min=1,max=65535,restart=true,internal=true"`
	Timeouts TimeoutsConfig `koanf:"timeouts" cfg:"desc=HTTP 超时"`
}

type TimeoutsConfig struct {
	Read     time.Duration `koanf:"read"     cfg:"desc=读超时,restart=true,internal=true"`
	Write    time.Duration `koanf:"write"    cfg:"desc=写超时,restart=true,internal=true"`
	Shutdown time.Duration `koanf:"shutdown" cfg:"desc=优雅关闭超时,restart=true,internal=true"`
}

type LogConfig struct {
	Level  string `koanf:"level"  cfg:"desc=日志级别,enum=debug|info|warn|error,advanced=true"`
	Format string `koanf:"format" cfg:"desc=输出格式,enum=text|json,restart=true,advanced=true"`
}

type PixivConfig struct {
	Proxy     string `koanf:"proxy"      cfg:"desc=HTTP/SOCKS 代理 URL（空串 = 直连）,sensitive=true"`
	BypassSNI bool   `koanf:"bypass_sni" cfg:"desc=对 API 启用 DoH + 替代 SNI（仅对受限网络）,restart=true"`
	StateFile string `koanf:"state_file" cfg:"desc=认证 token 持久化文件路径,restart=true,internal=true"`
}

type DownloadConfig struct {
	OutputDir         string        `koanf:"output_dir"          cfg:"desc=输出目录模板（Go text/template）"`
	FileTemplate      string        `koanf:"file_template"       cfg:"desc=单文件名模板"`
	FileGroupTemplate string        `koanf:"file_group_template" cfg:"desc=多页作品文件名模板"`
	MaxConcurrent     int           `koanf:"max_concurrent"      cfg:"desc=最大并发任务数,min=1,max=64,restart=true"`
	HTTPTimeout       time.Duration `koanf:"http_timeout"        cfg:"desc=单次下载请求超时"`
	Retry             RetryConfig   `koanf:"retry"               cfg:"desc=失败重试策略"`
	Referer           string        `koanf:"referer"             cfg:"desc=下载请求的 Referer 头,internal=true"`
	PximgBase         string        `koanf:"pximg_base"          cfg:"desc=图片源 base URL（可指向反代）"`
	Ugoira            UgoiraConfig  `koanf:"ugoira"              cfg:"desc=动图（Ugoira）输出"`
	StoreFile         string        `koanf:"store_file"          cfg:"desc=下载索引持久化文件路径,restart=true,internal=true"`
}

type RetryConfig struct {
	Max            int           `koanf:"max"             cfg:"desc=最大重试次数,min=0,max=10"`
	InitialBackoff time.Duration `koanf:"initial_backoff" cfg:"desc=首次重试退避时长"`
}

type UgoiraConfig struct {
	Format string `koanf:"format" cfg:"desc=输出格式（none 保留原 zip）,enum=webp|gif|none"`
}

type InboxConfig struct {
	BufferSize       int           `koanf:"buffer_size"       cfg:"desc=事件环形缓冲（Last-Event-ID 重放窗口）,min=1,max=100000,restart=true,internal=true"`
	ProgressThrottle time.Duration `koanf:"progress_throttle" cfg:"desc=进度事件最小间隔,internal=true"`
	Heartbeat        time.Duration `koanf:"heartbeat"         cfg:"desc=SSE keep-alive 间隔,internal=true"`
}

// defaults is the single source of truth for built-in defaults.
// Memoised because it's read several times per Patch/View and the map
// is treated as read-only by every consumer.
var defaults = sync.OnceValue(func() map[string]any {
	return map[string]any{
		"app.language":             "auto",
		"server.host":              "0.0.0.0",
		"server.port":              8080,
		"server.timeouts.read":     "15s",
		"server.timeouts.write":    "15s",
		"server.timeouts.shutdown": "10s",
		"log.level":                "info",
		"log.format":               "text",
		"pixiv.proxy":              "",
		"pixiv.bypass_sni":         false,
		"pixiv.state_file":         "./usr/state.json",

		"download.output_dir":            `./downloads/{{.Now | date "2006-01-02"}}`,
		"download.file_template":         `{{.IllustID}}_{{.Title | trunc 80}}{{.Ext}}`,
		"download.file_group_template":   `{{.IllustID}}_{{.Title | trunc 80}}/{{.Index | pad 2}}{{.Ext}}`,
		"download.max_concurrent":        4,
		"download.http_timeout":          "60s",
		"download.retry.max":             2,
		"download.retry.initial_backoff": "1s",
		"download.referer":               "https://app-api.pixiv.net/",
		"download.pximg_base":            "https://i.pximg.net",
		"download.ugoira.format":         "webp",
		"download.store_file":            "./usr/downloads.json",

		"inbox.buffer_size":       200,
		"inbox.progress_throttle": "250ms",
		"inbox.heartbeat":         "15s",
	}
})

// buildKoanf assembles a koanf instance from the layered sources:
// defaults → fileLayer (already a flat dotted-key map) → env(PIXIVBIU_*).
// Used by Load/Manager.Patch to validate candidate configs.
func buildKoanf(fileLayer map[string]any) (*koanf.Koanf, error) {
	k := koanf.New(".")

	if err := k.Load(confmap.Provider(defaults(), "."), nil); err != nil {
		return nil, fmt.Errorf("load defaults: %w", err)
	}

	if len(fileLayer) > 0 {
		if err := k.Load(confmap.Provider(fileLayer, "."), nil); err != nil {
			return nil, fmt.Errorf("load file layer: %w", err)
		}
	}

	known := make(map[string]struct{}, len(k.Keys()))
	for _, kk := range k.Keys() {
		known[kk] = struct{}{}
	}
	if err := k.Load(env.Provider(envPrefix, ".", newEnvKeyResolver(known)), nil); err != nil {
		return nil, fmt.Errorf("load env: %w", err)
	}
	return k, nil
}

func unmarshalConfig(k *koanf.Koanf) (*Config, error) {
	var cfg Config
	if err := k.UnmarshalWithConf("", &cfg, koanf.UnmarshalConf{
		Tag: "koanf",
		DecoderConfig: &mapstructure.DecoderConfig{
			Result:           &cfg,
			WeaklyTypedInput: true,
			DecodeHook: mapstructure.ComposeDecodeHookFunc(
				mapstructure.StringToTimeDurationHookFunc(),
			),
		},
	}); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("validate config: %w", err)
	}
	return &cfg, nil
}

// validate rejects misconfigurations that would otherwise fail per-
// request. A typo in download.ugoira.format used to silently cause
// every ugoira job to overwrite its own source zip; catching it here
// turns it into a loud startup error.
func (c *Config) validate() error {
	switch strings.ToLower(c.Download.Ugoira.Format) {
	case "webp", "gif", "none":
	default:
		return fmt.Errorf("download.ugoira.format: unsupported %q (want webp|gif|none)", c.Download.Ugoira.Format)
	}
	return nil
}

// newEnvKeyResolver maps PIXIVBIU_* env names to koanf dotted paths.
// A blind "_"→"." replacement breaks koanf tags that carry underscores
// (max_concurrent, bypass_sni, …); we brute-force every separator/literal
// split of the underscores and pick the deepest-nested schema hit.
// Unknown vars fall back to all-dots.
func newEnvKeyResolver(known map[string]struct{}) func(string) string {
	return func(s string) string {
		key := strings.ToLower(strings.TrimPrefix(s, envPrefix))
		var positions []int
		for i := 0; i < len(key); i++ {
			if key[i] == '_' {
				positions = append(positions, i)
			}
		}
		n := len(positions)
		if n == 0 {
			return key
		}
		best := ""
		bestDots := -1
		buf := []byte(key)
		for mask := 0; mask < (1 << n); mask++ {
			for i, pos := range positions {
				if mask&(1<<i) != 0 {
					buf[pos] = '.'
				} else {
					buf[pos] = '_'
				}
			}
			cand := string(buf)
			if _, ok := known[cand]; !ok {
				continue
			}
			dots := strings.Count(cand, ".")
			if dots > bestDots {
				best = cand
				bestDots = dots
			}
		}
		if best != "" {
			return best
		}
		return strings.ReplaceAll(key, "_", ".")
	}
}
