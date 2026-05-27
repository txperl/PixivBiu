// Package i18n provides a deliberately small translation layer for the
// startup banner and a handful of lifecycle log lines. It is not a general
// localisation framework: structured slog fields, access logs, and reload
// diagnostics stay in English by design, so the catalog only carries the
// human-readable boot/shutdown prose.
package i18n

import (
	"fmt"
	"os"
	"strings"
)

// Locale identifies a supported language. en is the base/fallback: every
// catalog key must define it, and any missing translation degrades to it.
type Locale string

const (
	LocaleEN   Locale = "en"
	LocaleZHCN Locale = "zh-CN"
	LocaleJA   Locale = "ja"
)

// catalog maps a stable message key to its per-locale text. Templates use
// printf-style verbs (%s, %d) so callers can interpolate values (addresses,
// versions, …) via Translator.T's variadic args. Keep the verb order
// identical across locales for a given key.
var catalog = map[string]map[Locale]string{
	"banner.tagline": {
		LocaleEN:   "Pixiv companion server",
		LocaleZHCN: "Pixiv 助手服务",
		LocaleJA:   "Pixiv コンパニオンサーバー",
	},
	"banner.listening": {
		LocaleEN:   "Listening",
		LocaleZHCN: "监听地址",
		LocaleJA:   "待受アドレス",
	},
	"banner.ready": {
		LocaleEN:   "Ready!",
		LocaleZHCN: "已就绪！",
		LocaleJA:   "起動完了！",
	},
	"lifecycle.starting": {
		LocaleEN:   "server starting",
		LocaleZHCN: "服务器启动中",
		LocaleJA:   "サーバーを起動しています",
	},
	"lifecycle.shutdown_signal": {
		LocaleEN:   "shutdown signal received",
		LocaleZHCN: "已收到关闭信号",
		LocaleJA:   "シャットダウン信号を受信しました",
	},
	"lifecycle.restart_draining": {
		LocaleEN:   "restart requested; draining for re-exec",
		LocaleZHCN: "已请求重启；正在排空以便重新执行",
		LocaleJA:   "再起動が要求されました。再実行のため処理を排出しています",
	},
	"lifecycle.reexec": {
		LocaleEN:   "re-executing to apply restart-required settings",
		LocaleZHCN: "正在重新执行以应用需要重启的设置",
		LocaleJA:   "再起動が必要な設定を適用するため再実行します",
	},
	"lifecycle.stopped": {
		LocaleEN:   "server stopped",
		LocaleZHCN: "服务器已停止",
		LocaleJA:   "サーバーが停止しました",
	},
	"lifecycle.drain_timeout": {
		LocaleEN:   "graceful drain timed out before restart; forcing close",
		LocaleZHCN: "重启前优雅排空超时；正在强制关闭",
		LocaleJA:   "再起動前の正常な排出がタイムアウトしました。強制的に閉じます",
	},
}

// Translator resolves catalog keys against a fixed locale.
type Translator struct {
	loc Locale
}

// New returns a Translator bound to loc. Pass the output of Resolve.
func New(loc Locale) *Translator {
	return &Translator{loc: loc}
}

// Locale reports the locale this Translator was constructed with.
func (t *Translator) Locale() Locale { return t.loc }

// T returns the localised text for key. Resolution order: the configured
// locale, then en as fallback; if key is absent from the catalog entirely it
// returns key verbatim so the gap is visible rather than rendering blank.
// When args are supplied the result is run through fmt.Sprintf.
func (t *Translator) T(key string, args ...any) string {
	entry, ok := catalog[key]
	if !ok {
		return key
	}
	text, ok := entry[t.loc]
	if !ok {
		text = entry[LocaleEN]
	}
	if len(args) > 0 {
		return fmt.Sprintf(text, args...)
	}
	return text
}

// Resolve turns a configured language setting into a concrete Locale.
//
// "auto" (or empty) sniffs the process locale from LANG, then LC_ALL, then
// LC_MESSAGES, taking the first non-empty value and prefix-matching it
// (zh* → zh-CN, ja* → ja, otherwise en). An explicit value is validated
// against the known locales and falls back to en when unrecognised.
func Resolve(configured string) Locale {
	if configured == "auto" || configured == "" {
		return resolveFromEnv()
	}
	switch Locale(configured) {
	case LocaleEN, LocaleZHCN, LocaleJA:
		return Locale(configured)
	default:
		return LocaleEN
	}
}

func resolveFromEnv() Locale {
	var raw string
	for _, name := range []string{"LANG", "LC_ALL", "LC_MESSAGES"} {
		if v := os.Getenv(name); v != "" {
			raw = v
			break
		}
	}
	raw = strings.ToLower(raw)
	switch {
	case strings.HasPrefix(raw, "zh"):
		return LocaleZHCN
	case strings.HasPrefix(raw, "ja"):
		return LocaleJA
	default:
		return LocaleEN
	}
}
