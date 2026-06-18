package config

import (
	"fmt"
	"maps"
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
	App      AppConfig      `koanf:"app"      cfg:"category=app"`      // general application settings
	Server   ServerConfig   `koanf:"server"   cfg:"category=system"`   // HTTP server (UI: System)
	Log      LogConfig      `koanf:"log"      cfg:"category=system"`   // log output (UI: System)
	Pixiv    PixivConfig    `koanf:"pixiv"    cfg:"category=pixiv"`    // Pixiv upstream & auth
	Download DownloadConfig `koanf:"download" cfg:"category=download"` // download behavior & templates
	Inbox    InboxConfig    `koanf:"inbox"    cfg:"category=system"`   // event bus / SSE (UI: System)
	Image    ImageConfig    `koanf:"image"    cfg:"category=image"`    // image proxy & disk cache
	Search   SearchConfig   `koanf:"search"   cfg:"category=pixiv"`    // search behavior (UI: Pixiv)
}

// AppConfig holds settings that don't belong to any single subsystem.
// language drives the frontend UI language: the backend stores it as an
// opaque string (only enum-validated) and the frontend reads it from
// GET /config, resolving `auto` against navigator.language. Backend
// logs/banner are always in English.
type AppConfig struct {
	Language    string       `koanf:"language"     cfg:"enum=auto|en|zh-CN|ja"` // UI language (auto = follow browser)
	OpenBrowser bool         `koanf:"open_browser" cfg:"restart=true"`          // open the web UI in the default browser at startup
	Update      UpdateConfig `koanf:"update"       cfg:"category=about"`        // update-check settings
}

// UpdateConfig controls the built-in GitHub-release update check. The
// background checker compares the running binary's version against the
// latest release; applying an update (user-triggered) downloads the
// matching archive, verifies its SHA-256, swaps the binary in place, and
// restarts. All keys are hot-reloadable: the checker reads them live on
// each tick, so toggling them never needs a restart.
//
// Channel is a cumulative maturity floor (stable < beta < alpha): each
// riskier channel is a superset that also accepts everything more stable,
// so every channel still converges onto stable releases when they're the
// newest. See internal/update/checker.go::releaseRank. Its default is not
// fixed: it tracks the running build's maturity (a pre-release build defaults
// to its own channel) via SetDefaultUpdateChannel; an explicit override wins.
type UpdateConfig struct {
	Enabled bool   `koanf:"enabled" cfg:"advanced=true"`                        // auto-check for updates
	Channel string `koanf:"channel" cfg:"enum=stable|beta|alpha,advanced=true"` // update channel (beta/alpha also accept prereleases)
}

type ServerConfig struct {
	Host         string         `koanf:"host"          cfg:"restart=true,internal=true"`                 // listen address (127.0.0.1 = local only; 0.0.0.0 = all interfaces, for LAN/Docker)
	Port         int            `koanf:"port"          cfg:"min=1,max=65535,restart=true,internal=true"` // listen port
	PortFallback bool           `koanf:"port_fallback" cfg:"restart=true,internal=true"`                 // advance to the next free port when busy (turn off in dev to pin the port)
	Timeouts     TimeoutsConfig `koanf:"timeouts"`                                                       // HTTP timeouts
}

type TimeoutsConfig struct {
	Read     time.Duration `koanf:"read"     cfg:"restart=true,internal=true"` // read timeout
	Write    time.Duration `koanf:"write"    cfg:"restart=true,internal=true"` // write timeout
	Shutdown time.Duration `koanf:"shutdown" cfg:"restart=true,internal=true"` // graceful-shutdown timeout
}

type LogConfig struct {
	Level  string `koanf:"level"  cfg:"enum=debug|info|warn|error,advanced=true"`  // log level
	Format string `koanf:"format" cfg:"enum=text|json,restart=true,advanced=true"` // output format
}

type PixivConfig struct {
	Proxy     string `koanf:"proxy"      cfg:"sensitive=true"`             // HTTP/SOCKS proxy URL (empty = direct)
	BypassSNI bool   `koanf:"bypass_sni" cfg:"restart=true,hidden=true"`   // use DoH + alternative SNI for the API (restricted networks only); hidden from UI, file/API only
	StateFile string `koanf:"state_file" cfg:"restart=true,internal=true"` // auth-token persistence file path
}

type DownloadConfig struct {
	OutputDir         string        `koanf:"output_dir"`                                      // output dir template (Go text/template)
	FileTemplate      string        `koanf:"file_template"`                                   // single-file name template
	FileGroupTemplate string        `koanf:"file_group_template"`                             // multi-page work name template
	MaxConcurrent     int           `koanf:"max_concurrent" cfg:"min=1,max=64,restart=true"`  // max concurrent tasks
	HTTPTimeout       time.Duration `koanf:"http_timeout"`                                    // per-download request timeout
	Retry             RetryConfig   `koanf:"retry"`                                           // failure-retry policy
	Referer           string        `koanf:"referer"        cfg:"internal=true"`              // Referer header for download requests
	Ugoira            UgoiraConfig  `koanf:"ugoira"`                                          // ugoira (animated) output
	StoreFile         string        `koanf:"store_file"     cfg:"restart=true,internal=true"` // download-index persistence file path
}

type RetryConfig struct {
	Max            int           `koanf:"max"             cfg:"min=0,max=10,advanced=true"` // max retry attempts
	InitialBackoff time.Duration `koanf:"initial_backoff" cfg:"advanced=true"`              // first-retry backoff duration
}

type UgoiraConfig struct {
	Format string `koanf:"format" cfg:"enum=webp|gif|none"` // output format (none keeps the original zip)
}

type InboxConfig struct {
	BufferSize       int           `koanf:"buffer_size"       cfg:"min=1,max=100000,restart=true,internal=true"` // event ring buffer (Last-Event-ID replay window)
	ProgressThrottle time.Duration `koanf:"progress_throttle" cfg:"internal=true"`                               // min interval between progress events
	Heartbeat        time.Duration `koanf:"heartbeat"         cfg:"internal=true"`                               // SSE keep-alive interval
}

// ImageConfig groups the image-proxy / disk-cache settings backing
// GET /proxy/img. Hot-reloadable: the cache ceiling is read live on each
// store and the HTTP client (which reuses pixiv.proxy) is rebuilt on reload.
type ImageConfig struct {
	Cache ImageCacheConfig `koanf:"cache"` // on-disk image cache
}

type ImageCacheConfig struct {
	MaxSizeMB int64 `koanf:"max_size_mb" cfg:"min=0"` // disk cache size cap in MB (0 = unlimited)
}

// MaxBytes is the cache cap in bytes (0 = unlimited). Keeping the MB→bytes
// conversion here means wiring code passes a consumer-ready value, matching how
// duration fields reach services already decoded.
func (c ImageCacheConfig) MaxBytes() int64 { return c.MaxSizeMB << 20 }

// SearchConfig groups search-behavior settings. Pixiv's native popularity sort
// (popular_desc) is Premium-only, so the bookmarks_desc / views_desc sorts
// approximate it for any account by ranking date-sorted results locally on the
// already-present total_bookmarks / total_view counts. Sample.Pages is the
// window size: one search page shows Sample.Pages*30 date_desc works re-ranked,
// and the pager steps to the next disjoint window. Sample.Concurrency bounds how
// many of those upstream pages the ranked handler fetches in parallel (the page
// offsets are deterministic +30 steps, so the window can be fanned out instead of
// walked one-by-one). Hot-reloadable: the search handler reads both live per
// request, via atomics seeded + updated by an OnReload hook in
// cmd/server/main.go (Manager.Config() is boot-pinned), so there's no restart tag.
type SearchConfig struct {
	Sample SearchSampleConfig `koanf:"sample"` // ranked-sort window size + fan-out
}

type SearchSampleConfig struct {
	Pages       int `koanf:"pages" cfg:"min=1,max=20"`      // upstream pages (~30 works each) per ranked search page for bookmarks_desc/views_desc
	Concurrency int `koanf:"concurrency" cfg:"min=1,max=8"` // max upstream pages fetched in parallel per ranked search (capped at Pages)
}

// defaultUpdateChannel is the build-derived default for app.update.channel,
// seeded once at startup by SetDefaultUpdateChannel from the running binary's
// maturity (a pre-release build defaults to its own channel). An explicit user
// override in settings.json / env still wins; this only moves the baseline.
var defaultUpdateChannel = "stable"

// SetDefaultUpdateChannel overrides the built-in default update channel. It MUST
// be called before NewManager, because defaults() is read while building the
// schema and seeding the merged config. An empty or unknown value is ignored,
// leaving the "stable" default; valid values are stable|beta|alpha (the channel
// enum). Callers derive the argument from the build via update.DefaultChannel.
func SetDefaultUpdateChannel(ch string) {
	switch ch {
	case "stable", "beta", "alpha":
		defaultUpdateChannel = ch
	}
}

// baseDefaults holds the static built-in defaults. Memoised because it's read
// several times per Patch/View and the map is treated as read-only by every
// consumer. The one dynamic key, app.update.channel, is overlaid by defaults()
// so the default can track the running build's maturity.
var baseDefaults = sync.OnceValue(func() map[string]any {
	return map[string]any{
		"app.language":             "auto",
		"app.open_browser":         true,
		"app.update.enabled":       true,
		"server.host":              "127.0.0.1",
		"server.port":              4001,
		"server.port_fallback":     true,
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
		"download.ugoira.format":         "webp",
		"download.store_file":            "./usr/downloads.json",

		"inbox.buffer_size":       200,
		"inbox.progress_throttle": "250ms",
		"inbox.heartbeat":         "15s",

		"image.cache.max_size_mb": int64(2048), // 2 GiB

		"search.sample.pages":       5, // ~150 works sampled for bookmarks_desc/views_desc local sort
		"search.sample.concurrency": 3, // upstream pages fetched in parallel per ranked search (conservative vs Pixiv rate limits)
	}
})

// defaults is the single source of truth for built-in defaults. It returns a
// fresh copy of the memoised static baseDefaults with app.update.channel
// overlaid from defaultUpdateChannel, so the build-derived channel reaches the
// consumers that should honor it: the merged config, the schema "Default", and
// the effective view. Diff-only persistence deliberately reads baseDefaults
// instead (see pruneAgainstDefaults), so an explicitly-chosen channel is never
// pruned. The copy is cheap and may be treated as read-only by callers, as before.
func defaults() map[string]any {
	out := maps.Clone(baseDefaults())
	out["app.update.channel"] = defaultUpdateChannel
	return out
}

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
