// Package sysproxy discovers the operating system's configured HTTP/SOCKS
// proxy so the app can offer it as a candidate when a direct connection to
// Pixiv fails. The motivating case: users behind the GFW who enabled a proxy
// tool's "system proxy" but not its TUN/virtual-NIC mode. A direct probe then
// fails, and — crucially — the GUI system-proxy setting is invisible to a
// process's HTTP(S)_PROXY environment variables, so the OS-native config is
// the only place it can be found.
//
// The package is deliberately pure Go (no cgo): macOS is read via the `scutil`
// subprocess and Windows via the registry, so the project's CGO_ENABLED=0
// cross-compile from a single Linux runner keeps working.
package sysproxy

import (
	"context"
	"net/url"
	"os"
	"strings"
)

// Source labels where a candidate was discovered.
const (
	SourceSystem = "system" // OS GUI proxy settings (macOS scutil / Windows registry)
	SourceEnv    = "env"    // HTTP(S)_PROXY / ALL_PROXY environment variables
)

// Candidate is a normalized proxy URL plus where it was discovered.
type Candidate struct {
	URL    string `json:"url"`    // scheme://host[:port], ready for url.Parse + http.ProxyURL
	Source string `json:"source"` // one of the Source* constants
}

// Detect returns proxy candidates discovered from the operating system,
// ordered most-specific first: the OS GUI proxy settings (Source "system")
// before proxy environment variables (Source "env"), deduplicated by URL.
//
// An empty slice means nothing usable was found — including the case where the
// OS only has a PAC (proxy auto-config URL) configured, which this package
// deliberately does not evaluate: doing so would require fetching and running
// the PAC script. The common GFW proxy tools (Clash, V2RayN, …) set an
// explicit host:port system proxy, so skipping PAC is an acceptable v1 limit.
//
// Detect reads local configuration only; it performs no network I/O. ctx
// bounds any subprocess a platform backend spawns (macOS scutil).
func Detect(ctx context.Context) []Candidate {
	return assemble(detectSystem(ctx), detectEnv())
}

// assemble normalizes and deduplicates raw proxy strings from the two sources
// into ordered Candidates (system first). Split from Detect so the ordering
// and dedup logic is testable without touching the live OS.
func assemble(system, env []string) []Candidate {
	var out []Candidate
	seen := map[string]bool{}
	add := func(raw, source string) {
		u := normalize(raw)
		if u == "" || seen[u] {
			return
		}
		seen[u] = true
		out = append(out, Candidate{URL: u, Source: source})
	}
	for _, raw := range system {
		add(raw, SourceSystem)
	}
	for _, raw := range env {
		add(raw, SourceEnv)
	}
	return out
}

// detectEnv reads the conventional proxy environment variables, HTTPS first
// (the app only reaches Pixiv over HTTPS), then HTTP, then ALL_PROXY. Both
// upper- and lower-case spellings are honored, as curl and Go's own
// http.ProxyFromEnvironment do.
func detectEnv() []string {
	var out []string
	for _, name := range []string{
		"HTTPS_PROXY", "https_proxy",
		"HTTP_PROXY", "http_proxy",
		"ALL_PROXY", "all_proxy",
	} {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			out = append(out, v)
		}
	}
	return out
}

// normalize canonicalizes a raw proxy string into the scheme://host[:port]
// form the rest of the app requires (the config validator in cmd/server
// rejects a proxy whose url.Host is empty). A bare "host:port" with no scheme
// is treated as an HTTP proxy — matching how browsers interpret a plain
// system-proxy entry. Returns "" when the input can't be made usable.
func normalize(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// Without a scheme url.Parse would read the host as the scheme and leave
	// Host empty (the exact failure cmd/server's validator guards against).
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	// A candidate is just scheme://host[:port]. Strip userinfo as well as any
	// path/query: an env proxy like http://user:pass@host:8080 must not leak its
	// credentials through the unauthenticated /auth/proxy/detect endpoint or into
	// the UI/settings. A proxy that needs auth must be entered by hand.
	u.User = nil
	u.Path, u.RawQuery, u.Fragment = "", "", ""
	return u.String()
}

// buildProxy assembles a scheme://host[:port] URL, or "" when host is empty.
// port may be "" — either because there is none or because host already
// carries it (the Windows per-protocol values do).
func buildProxy(scheme, host, port string) string {
	if host == "" {
		return ""
	}
	if port != "" {
		host += ":" + port
	}
	return scheme + "://" + host
}

// parseScutil turns `scutil --proxy` output into candidate proxy URLs. macOS
// prints a dictionary of `Key : Value` lines, e.g.:
//
//	<dictionary> {
//	  HTTPSEnable : 1
//	  HTTPSProxy : 127.0.0.1
//	  HTTPSPort : 7890
//	  SOCKSEnable : 0
//	}
//
// HTTPS is preferred over HTTP (Pixiv is HTTPS-only), and an explicit HTTP(S)
// proxy is preferred over SOCKS. Lives here (not in the darwin file) so it is
// testable on any platform.
func parseScutil(s string) []string {
	m := map[string]string{}
	for _, line := range strings.Split(s, "\n") {
		k, v, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		m[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}

	var out []string
	// HTTPS first (Pixiv is HTTPS-only), then HTTP, then SOCKS. Both HTTP(S)
	// proxies map to an http:// proxy URL; SOCKS to socks5://.
	add := func(enable, host, port, scheme string) {
		if m[enable] != "1" {
			return
		}
		if u := buildProxy(scheme, m[host], m[port]); u != "" {
			out = append(out, u)
		}
	}
	add("HTTPSEnable", "HTTPSProxy", "HTTPSPort", "http")
	add("HTTPEnable", "HTTPProxy", "HTTPPort", "http")
	add("SOCKSEnable", "SOCKSProxy", "SOCKSPort", "socks5")
	return out
}

// parseWinINETProxyServer parses the WinINET ProxyServer registry string. It
// is either a single "host:port" applied to every protocol, or a per-protocol
// list like "http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891".
// HTTPS is preferred over HTTP; a socks=* entry becomes a socks5:// candidate.
// Lives here (not in the windows file) so it is testable on any platform.
func parseWinINETProxyServer(server string) []string {
	server = strings.TrimSpace(server)
	if server == "" {
		return nil
	}
	// No "scheme=" segments: a single value applied to all protocols.
	if !strings.Contains(server, "=") {
		return []string{buildProxy("http", server, "")}
	}
	byProto := map[string]string{}
	for _, part := range strings.Split(server, ";") {
		proto, addr, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		byProto[strings.ToLower(strings.TrimSpace(proto))] = strings.TrimSpace(addr)
	}
	var out []string
	// HTTPS preferred over HTTP; socks=* becomes a socks5:// candidate. The
	// per-protocol addresses already carry host:port, so port is "".
	add := func(proto, scheme string) {
		if u := buildProxy(scheme, byProto[proto], ""); u != "" {
			out = append(out, u)
		}
	}
	add("https", "http")
	add("http", "http")
	add("socks", "socks5")
	return out
}
