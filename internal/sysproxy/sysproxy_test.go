package sysproxy

import (
	"reflect"
	"testing"
)

func TestNormalize(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"", ""},
		{"   ", ""},
		{"127.0.0.1:7890", "http://127.0.0.1:7890"},        // bare host:port → http
		{"http://127.0.0.1:7890", "http://127.0.0.1:7890"}, // already a URL
		{"  http://127.0.0.1:7890  ", "http://127.0.0.1:7890"},
		{"socks5://127.0.0.1:1080", "socks5://127.0.0.1:1080"},
		{"http://127.0.0.1:7890/pac", "http://127.0.0.1:7890"},       // path stripped
		{"http://user:pass@127.0.0.1:8080", "http://127.0.0.1:8080"}, // credentials stripped
		{"http://user@127.0.0.1:8080", "http://127.0.0.1:8080"},      // username-only stripped
		{"http://", ""}, // no host
		{"://nope", ""}, // unparseable
	}
	for _, c := range cases {
		if got := normalize(c.in); got != c.want {
			t.Errorf("normalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestParseScutil(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{
			name: "https and http same host deduped later by assemble",
			in: `<dictionary> {
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7890
  HTTPSEnable : 1
  HTTPSProxy : 127.0.0.1
  HTTPSPort : 7890
  SOCKSEnable : 0
}`,
			// parseScutil keeps both (HTTPS first); dedup happens in assemble.
			want: []string{"http://127.0.0.1:7890", "http://127.0.0.1:7890"},
		},
		{
			name: "socks only",
			in: `  SOCKSEnable : 1
  SOCKSProxy : 127.0.0.1
  SOCKSPort : 1080
`,
			want: []string{"socks5://127.0.0.1:1080"},
		},
		{
			name: "disabled yields nothing",
			in: `  HTTPSEnable : 0
  HTTPSProxy : 127.0.0.1
  HTTPSPort : 7890`,
			want: nil,
		},
		{
			name: "pac-only is ignored",
			in: `  ProxyAutoConfigEnable : 1
  ProxyAutoConfigURLString : http://wpad/wpad.dat`,
			want: nil,
		},
		{
			name: "host without port",
			in: `  HTTPSEnable : 1
  HTTPSProxy : proxy.local`,
			want: []string{"http://proxy.local"},
		},
	}
	for _, c := range cases {
		if got := parseScutil(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: parseScutil = %#v, want %#v", c.name, got, c.want)
		}
	}
}

func TestParseWinINETProxyServer(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{"empty", "", nil},
		{"single all-protocol", "127.0.0.1:7890", []string{"http://127.0.0.1:7890"}},
		{
			name: "per-protocol prefers https then http then socks",
			in:   "http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891",
			want: []string{"http://127.0.0.1:7890", "http://127.0.0.1:7890", "socks5://127.0.0.1:7891"},
		},
		{
			name: "socks only",
			in:   "socks=127.0.0.1:1080",
			want: []string{"socks5://127.0.0.1:1080"},
		},
		{
			name: "whitespace tolerated",
			in:   " https = 127.0.0.1:7890 ; http = 127.0.0.1:7890 ",
			want: []string{"http://127.0.0.1:7890", "http://127.0.0.1:7890"},
		},
	}
	for _, c := range cases {
		if got := parseWinINETProxyServer(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: parseWinINETProxyServer = %#v, want %#v", c.name, got, c.want)
		}
	}
}

func TestAssemble(t *testing.T) {
	cases := []struct {
		name        string
		system, env []string
		want        []Candidate
	}{
		{
			name: "system before env, deduped across sources",
			// HTTPS+HTTP both 7890 (one survives, labelled system); env dup of
			// the same URL drops; a distinct env socks survives as env.
			system: []string{"http://127.0.0.1:7890", "http://127.0.0.1:7890"},
			env:    []string{"http://127.0.0.1:7890", "socks5://127.0.0.1:1080"},
			want: []Candidate{
				{URL: "http://127.0.0.1:7890", Source: SourceSystem},
				{URL: "socks5://127.0.0.1:1080", Source: SourceEnv},
			},
		},
		{
			name: "env-only when no system proxy",
			env:  []string{"127.0.0.1:8080"},
			want: []Candidate{{URL: "http://127.0.0.1:8080", Source: SourceEnv}},
		},
		{
			name:   "nothing configured",
			system: nil,
			env:    nil,
			want:   nil,
		},
		{
			name:   "junk dropped",
			system: []string{"http://", "   "},
			want:   nil,
		},
	}
	for _, c := range cases {
		if got := assemble(c.system, c.env); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: assemble = %#v, want %#v", c.name, got, c.want)
		}
	}
}

func TestDetectEnv(t *testing.T) {
	// Clear every spelling first so an inherited proxy var can't leak in.
	for _, name := range []string{
		"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy",
	} {
		t.Setenv(name, "")
	}
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:3128")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:7890")

	// HTTPS is read before HTTP.
	want := []string{"http://127.0.0.1:7890", "http://127.0.0.1:3128"}
	if got := detectEnv(); !reflect.DeepEqual(got, want) {
		t.Errorf("detectEnv() = %#v, want %#v", got, want)
	}
}
