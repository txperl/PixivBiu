package i18n

import "testing"

// allLocales is every locale the catalog must cover.
var allLocales = []Locale{LocaleEN, LocaleZHCN, LocaleJA}

func TestCatalog_Completeness(t *testing.T) {
	for key, entry := range catalog {
		for _, loc := range allLocales {
			if _, ok := entry[loc]; !ok {
				t.Errorf("catalog key %q missing locale %q", key, loc)
			}
		}
	}
}

func TestT_FallbackToEN(t *testing.T) {
	// Inject a key that only defines EN to exercise the missing-locale path
	// without depending on the real catalog being incomplete.
	const key = "test.only_en"
	catalog[key] = map[Locale]string{LocaleEN: "english only"}
	t.Cleanup(func() { delete(catalog, key) })

	tr := New(LocaleJA)
	if got := tr.T(key); got != "english only" {
		t.Errorf("T(%q) with missing JA = %q, want EN fallback %q", key, got, "english only")
	}
}

func TestT_MissingKeyReturnsKey(t *testing.T) {
	tr := New(LocaleEN)
	const key = "does.not.exist"
	if got := tr.T(key); got != key {
		t.Errorf("T(%q) = %q, want the key itself", key, got)
	}
}

func TestT_ArgsInterpolate(t *testing.T) {
	const key = "test.args"
	catalog[key] = map[Locale]string{
		LocaleEN:   "listening on %s port %d",
		LocaleZHCN: "监听 %s 端口 %d",
		LocaleJA:   "%s ポート %d で待受",
	}
	t.Cleanup(func() { delete(catalog, key) })

	tr := New(LocaleEN)
	if got, want := tr.T(key, "localhost", 8080), "listening on localhost port 8080"; got != want {
		t.Errorf("T with args = %q, want %q", got, want)
	}
	trJA := New(LocaleJA)
	if got, want := trJA.T(key, "localhost", 8080), "localhost ポート 8080 で待受"; got != want {
		t.Errorf("T(JA) with args = %q, want %q", got, want)
	}
}

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
