// Package update implements PixivBiu's built-in version check and one-click
// self-update against GitHub Releases.
//
// The Service periodically (and on demand) asks the GitHub API for the newest
// release, compares it against the running binary's version, and caches the
// result for the API/UI to read. Applying an update — always user-triggered —
// downloads the release archive built for this OS/arch, verifies its SHA-256
// against the release's checksums.txt, extracts the binary, and swaps it in
// place via github.com/minio/selfupdate. The caller then restarts the process
// (the existing reexec path) so the new binary takes over.
//
// Trust model: HTTPS to GitHub plus SHA-256 verification against the release's
// own checksums.txt. There is no signature check yet (GoReleaser does not sign
// today); cosign/minisign signing is a future hardening step.
package update

import (
	"fmt"
	"net/http"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/mod/semver"

	"github.com/txperl/PixivBiu/internal/config"
)

// userAgent is sent on every GitHub request — the API rejects requests without
// one. Including the version aids server-side debugging.
const userAgent = "PixivBiu-updater"

// Status is the cached result of the most recent update check. It is the wire
// shape the API serves to the frontend (field names map 1:1 in the handler).
type Status struct {
	CurrentVersion  string    // running binary version (main.version)
	LatestVersion   string    // newest release tag seen, normalized (e.g. v3.1.0); empty if unknown
	UpdateAvailable bool      // a newer release exists AND this is a real release build
	IsDev           bool      // running a dev/non-release build; updates are never offered
	ReleaseURL      string    // GitHub release page for LatestVersion
	ReleaseNotes    string    // release body (markdown), as published
	PublishedAt     time.Time // when LatestVersion was published
	AssetName       string    // archive asset matching this OS/arch in the latest release
	LastChecked     time.Time // when this status was produced; zero if never checked
	LastError       string    // human-safe error from the most recent check, if any
}

// Service tracks the running version against GitHub releases. It is safe for
// concurrent use: the cached status, live config, and HTTP client are all
// guarded by mu.
type Service struct {
	current string // running binary version, verbatim from main.version
	owner   string
	repo    string

	mu     sync.RWMutex
	cfg    config.UpdateConfig
	proxy  string
	client *http.Client
	status Status

	// applying is the single-flight guard for Apply: it mutates the running
	// executable, so at most one may be in flight. Held independently of mu,
	// which guards the cached fields and must not be locked for Apply's minutes.
	applying atomic.Bool
}

// NewService builds an update Service for the given repo. current is the
// running binary's version string (main.version); cfg and proxy seed the live,
// reloadable settings. The proxy mirrors pixiv.proxy so update traffic takes
// the same path users already configured for Pixiv (e.g. behind the GFW).
func NewService(current, owner, repo string, cfg config.UpdateConfig, proxy string) *Service {
	s := &Service{
		current: current,
		owner:   owner,
		repo:    repo,
		cfg:     cfg,
		proxy:   proxy,
		status: Status{
			CurrentVersion: current,
			IsDev:          isDevVersion(current),
		},
	}
	s.client = buildClient(proxy)
	return s
}

// config returns a snapshot of the live update settings under the read lock.
func (s *Service) config() config.UpdateConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

// checkInterval is the fixed gap between automatic background checks. It is not
// user-configurable: a few hours is plenty for a desktop tool, and a knob here
// is more footgun (a tiny value hammering GitHub) than feature.
const checkInterval = 3 * time.Hour

// Status returns the last cached check result without touching the network.
func (s *Service) Status() Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.status
}

// Reload applies new config live. The proxy may have changed, so the HTTP
// client is rebuilt when it differs. Mirrors the OnReload hooks in main.go.
func (s *Service) Reload(cfg config.UpdateConfig, proxy string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg
	if proxy != s.proxy {
		s.proxy = proxy
		s.client = buildClient(proxy)
	}
}

// httpClient returns the current client under the read lock.
func (s *Service) httpClient() *http.Client {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.client
}

// buildClient mirrors pixiv.buildClient's proxy handling (internal/pixiv/
// service.go): an explicit proxy URL routes traffic through it, otherwise the
// default client is used. No Client.Timeout — it caps the entire request and
// would override the longer download context; each caller sets its own
// per-request context deadline instead (20s for the release check in
// fetchReleases, 5m for downloads in download).
func buildClient(proxy string) *http.Client {
	c := &http.Client{}
	if proxy != "" {
		if u, err := url.Parse(proxy); err == nil && u.Host != "" {
			c.Transport = &http.Transport{Proxy: http.ProxyURL(u)}
		}
	}
	return c
}

// normalizeVersion ensures a leading "v" so the value parses with x/mod/semver
// (GoReleaser strips the "v", so release builds arrive as bare "3.0.0").
func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if !strings.HasPrefix(v, "v") {
		return "v" + v
	}
	return v
}

// isDevVersion reports whether v is a local/dev build rather than a published
// release. Real releases are clean semver, optionally on the alpha/beta/rc
// channels; anything else with a prerelease label (the default "0.1.0-dev", a
// GoReleaser "-snapshot-…", or a git-describe "-N-gHASH"/"-dirty") is treated
// as dev so the UI never nags and Apply refuses to touch it. The prerelease
// taxonomy lives in one place: releaseRank tags exactly those non-release
// suffixes with rank -1.
func isDevVersion(v string) bool {
	nv := normalizeVersion(v)
	if !semver.IsValid(nv) {
		return true
	}
	return releaseRank(nv) < 0
}

// assetName builds the GoReleaser archive name for a release version and the
// running OS/arch. Mirrors `.goreleaser.yaml` name_template
// (PixivBiu_{Version}_{Os}_{Arch}) with the tar.gz/zip override for Windows.
// version is the release's semver WITHOUT the leading "v" (GoReleaser's .Version).
func assetName(version string) string {
	ext := "tar.gz"
	if runtime.GOOS == "windows" {
		ext = "zip"
	}
	return fmt.Sprintf("PixivBiu_%s_%s_%s.%s",
		strings.TrimPrefix(version, "v"), runtime.GOOS, runtime.GOARCH, ext)
}
