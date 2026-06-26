//go:build windows

package sysproxy

import (
	"context"

	"golang.org/x/sys/windows/registry"
)

// detectSystem reads the current user's WinINET proxy configuration from the
// registry — the same values the "Settings ▸ Network & Internet ▸ Proxy" /
// legacy "Internet Options ▸ LAN settings" GUI writes. These are not exposed
// through HTTP(S)_PROXY env vars, so the registry is the only place a GUI-set
// system proxy can be read. A configured PAC (AutoConfigURL) is ignored — see
// Detect. Any failure yields no candidates, leaving Detect's env fallback.
func detectSystem(_ context.Context) []string {
	k, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Internet Settings`,
		registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer k.Close()

	if enable, _, err := k.GetIntegerValue("ProxyEnable"); err != nil || enable == 0 {
		return nil
	}
	server, _, err := k.GetStringValue("ProxyServer")
	if err != nil {
		return nil
	}
	return parseWinINETProxyServer(server)
}
