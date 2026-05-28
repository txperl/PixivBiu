// Package i18n resolves the configured `app.language` (including `auto`)
// into a concrete Locale. The backend itself logs in English; the resolved
// locale is surfaced to the frontend via GET /i18n so its UI can mirror
// the backend's choice without sniffing the browser.
package i18n

import (
	"os"
	"strings"
)

// Locale identifies a supported language. en is the base/fallback.
type Locale string

const (
	LocaleEN   Locale = "en"
	LocaleZHCN Locale = "zh-CN"
	LocaleJA   Locale = "ja"
)

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
