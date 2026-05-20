package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/go-viper/mapstructure/v2"
	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/confmap"
	"github.com/knadh/koanf/providers/env"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

const envPrefix = "PIXIVBIU_"

type Config struct {
	Server   ServerConfig   `koanf:"server"`
	Log      LogConfig      `koanf:"log"`
	Pixiv    PixivConfig    `koanf:"pixiv"`
	Download DownloadConfig `koanf:"download"`
	Inbox    InboxConfig    `koanf:"inbox"`
}

type ServerConfig struct {
	Host     string         `koanf:"host"`
	Port     int            `koanf:"port"`
	Timeouts TimeoutsConfig `koanf:"timeouts"`
}

type TimeoutsConfig struct {
	Read     time.Duration `koanf:"read"`
	Write    time.Duration `koanf:"write"`
	Shutdown time.Duration `koanf:"shutdown"`
}

type LogConfig struct {
	Level  string `koanf:"level"`
	Format string `koanf:"format"`
}

type PixivConfig struct {
	Proxy     string `koanf:"proxy"`
	Language  string `koanf:"language"`
	BypassSNI bool   `koanf:"bypass_sni"`
	StateFile string `koanf:"state_file"`
}

type DownloadConfig struct {
	OutputDir         string        `koanf:"output_dir"`
	FileTemplate      string        `koanf:"file_template"`
	FileGroupTemplate string        `koanf:"file_group_template"`
	MaxConcurrent     int           `koanf:"max_concurrent"`
	HTTPTimeout       time.Duration `koanf:"http_timeout"`
	Retry             RetryConfig   `koanf:"retry"`
	Referer           string        `koanf:"referer"`
	PximgBase         string        `koanf:"pximg_base"`
	Ugoira            UgoiraConfig  `koanf:"ugoira"`
	StoreFile         string        `koanf:"store_file"`
}

type RetryConfig struct {
	Max            int           `koanf:"max"`
	InitialBackoff time.Duration `koanf:"initial_backoff"`
}

type UgoiraConfig struct {
	Format string `koanf:"format"` // webp | gif | none
}

type InboxConfig struct {
	BufferSize       int           `koanf:"buffer_size"`
	ProgressThrottle time.Duration `koanf:"progress_throttle"`
	Heartbeat        time.Duration `koanf:"heartbeat"`
}

func defaults() map[string]any {
	return map[string]any{
		"server.host":              "0.0.0.0",
		"server.port":              8080,
		"server.timeouts.read":     "15s",
		"server.timeouts.write":    "15s",
		"server.timeouts.shutdown": "10s",
		"log.level":                "info",
		"log.format":               "text",
		"pixiv.proxy":              "",
		"pixiv.language":           "zh-cn",
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
}

func Load(path string) (*Config, error) {
	k := koanf.New(".")

	if err := k.Load(confmap.Provider(defaults(), "."), nil); err != nil {
		return nil, fmt.Errorf("load defaults: %w", err)
	}

	if path != "" {
		if _, err := os.Stat(path); err == nil {
			if err := k.Load(file.Provider(path), yaml.Parser()); err != nil {
				return nil, fmt.Errorf("load config file %q: %w", path, err)
			}
		} else if !os.IsNotExist(err) {
			return nil, fmt.Errorf("stat config file %q: %w", path, err)
		}
	}

	// Schema snapshot feeds the env resolver's underscore disambiguation.
	known := make(map[string]struct{}, len(k.Keys()))
	for _, kk := range k.Keys() {
		known[kk] = struct{}{}
	}

	if err := k.Load(env.Provider(envPrefix, ".", newEnvKeyResolver(known)), nil); err != nil {
		return nil, fmt.Errorf("load env: %w", err)
	}

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
	case "", "webp", "gif", "none":
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
