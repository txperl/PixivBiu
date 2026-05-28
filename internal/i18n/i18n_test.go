package i18n

import "testing"

func TestResolve(t *testing.T) {
	tests := []struct {
		name       string
		configured string
		lang       string // value for LANG; "" means unset for the auto cases
		want       Locale
	}{
		{name: "explicit zh-CN", configured: "zh-CN", want: LocaleZHCN},
		{name: "explicit en", configured: "en", want: LocaleEN},
		{name: "explicit ja", configured: "ja", want: LocaleJA},
		{name: "garbage falls back to en", configured: "garbage", want: LocaleEN},
		{name: "auto LANG ja", configured: "auto", lang: "ja_JP.UTF-8", want: LocaleJA},
		{name: "auto LANG zh", configured: "auto", lang: "zh_CN.UTF-8", want: LocaleZHCN},
		{name: "auto LANG en", configured: "auto", lang: "en_US.UTF-8", want: LocaleEN},
		{name: "auto LANG unknown", configured: "auto", lang: "fr_FR.UTF-8", want: LocaleEN},
		{name: "auto LANG unset", configured: "auto", lang: "", want: LocaleEN},
		{name: "empty configured uses env", configured: "", lang: "zh_CN.UTF-8", want: LocaleZHCN},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Clear the env locale vars so each case is isolated, then set LANG.
			t.Setenv("LC_ALL", "")
			t.Setenv("LC_MESSAGES", "")
			t.Setenv("LANG", tc.lang)
			if got := Resolve(tc.configured); got != tc.want {
				t.Errorf("Resolve(%q) with LANG=%q = %q, want %q", tc.configured, tc.lang, got, tc.want)
			}
		})
	}
}

func TestResolve_EnvPrecedence(t *testing.T) {
	t.Setenv("LANG", "")
	t.Setenv("LC_ALL", "ja_JP.UTF-8")
	t.Setenv("LC_MESSAGES", "zh_CN.UTF-8")
	if got := Resolve("auto"); got != LocaleJA {
		t.Errorf("Resolve(auto) = %q, want %q (LC_ALL before LC_MESSAGES)", got, LocaleJA)
	}
}
