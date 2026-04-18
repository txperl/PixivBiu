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
	Server ServerConfig `koanf:"server"`
	Log    LogConfig    `koanf:"log"`
	Pixiv  PixivConfig  `koanf:"pixiv"`
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

	if err := k.Load(env.Provider(envPrefix, ".", envKey), nil); err != nil {
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
	return &cfg, nil
}

// envKey maps PIXIVBIU_SERVER_PORT -> server.port and
// PIXIVBIU_SERVER_TIMEOUTS_READ -> server.timeouts.read.
func envKey(s string) string {
	s = strings.TrimPrefix(s, envPrefix)
	s = strings.ToLower(s)
	return strings.ReplaceAll(s, "_", ".")
}
