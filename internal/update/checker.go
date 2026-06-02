package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"golang.org/x/mod/semver"
)

// startupDelay holds the first automatic check briefly after boot so it doesn't
// compete with startup work (auth refresh, download resume).
const startupDelay = 10 * time.Second

// Start launches the background check loop in a goroutine. It performs an
// initial check shortly after boot, then re-checks every Interval, skipping
// ticks while disabled (app.update.enabled) and re-reading the live interval
// each cycle so a config reload takes effect without a restart. The loop exits
// when ctx is cancelled.
func (s *Service) Start(ctx context.Context, logger *slog.Logger) {
	go s.loop(ctx, logger)
}

func (s *Service) loop(ctx context.Context, logger *slog.Logger) {
	timer := time.NewTimer(startupDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			cfg := s.config()
			if cfg.Enabled {
				if _, err := s.Check(ctx); err != nil {
					logger.Warn("update check failed", slog.Any("error", err))
				} else if st := s.Status(); st.UpdateAvailable {
					logger.Info("update available",
						slog.String("current", st.CurrentVersion),
						slog.String("latest", st.LatestVersion))
				}
			}
			timer.Reset(checkInterval(cfg))
		}
	}
}

// githubAPI is the releases endpoint base. A var (not const) so tests can point
// it at an httptest server.
var githubAPI = "https://api.github.com"

// ghRelease is the subset of the GitHub release object we consume.
type ghRelease struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Body        string    `json:"body"`
	Draft       bool      `json:"draft"`
	Prerelease  bool      `json:"prerelease"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// releaseInfo is the resolved "newest applicable release" shared by Check and
// Apply. Assets are indexed by name for asset/checksums lookup.
type releaseInfo struct {
	tag         string
	version     string // normalized semver with leading "v"
	notes       string
	htmlURL     string
	publishedAt time.Time
	assets      map[string]ghAsset
}

// hasBinaryForThisPlatform reports whether the release carries everything Apply
// needs for the running OS/arch: the archive built for this platform plus the
// checksums.txt used to verify it. Check gates UpdateAvailable on this so it
// never advertises an update Apply would immediately refuse.
func (ri *releaseInfo) hasBinaryForThisPlatform() bool {
	if _, ok := ri.assets[assetName(ri.version)]; !ok {
		return false
	}
	_, ok := ri.assets["checksums.txt"]
	return ok
}

// Check fetches the newest applicable release, recomputes the cached Status,
// and returns it. Network/parse failures are recorded in Status.LastError (and
// returned) but never panic; the previously-known latest is preserved.
func (s *Service) Check(ctx context.Context) (Status, error) {
	ri, err := s.resolveLatest(ctx)

	s.mu.Lock()
	defer s.mu.Unlock()

	s.status.CurrentVersion = s.current
	s.status.IsDev = isDevVersion(s.current)
	s.status.LastChecked = time.Now()

	if err != nil {
		s.status.LastError = err.Error()
		return s.status, err
	}
	s.status.LastError = ""

	s.status.LatestVersion = ri.tag
	s.status.ReleaseURL = ri.htmlURL
	s.status.ReleaseNotes = ri.notes
	s.status.PublishedAt = ri.publishedAt

	// An update is offered only when it is strictly newer, a real release build
	// (not a dev/`go run`/local build, which is meaningless to swap), and
	// actually installable on this platform — the release must carry both the
	// archive for this OS/arch and its checksums.txt. Otherwise Apply would
	// refuse it, leaving the user a badge/button that can never succeed. The
	// latest version is still recorded above for display regardless.
	applicable := ri.hasBinaryForThisPlatform()
	s.status.AssetName = ""
	if applicable {
		s.status.AssetName = assetName(ri.version)
	}
	s.status.UpdateAvailable = !s.status.IsDev && applicable &&
		semver.Compare(ri.version, normalizeVersion(s.current)) > 0
	return s.status, nil
}

// resolveLatest returns the newest release that matches the current channel
// (stable, or stable+prerelease when include_prerelease is on). Releases whose
// tag isn't valid semver (e.g. legacy "v2.6.4b") are skipped.
func (s *Service) resolveLatest(ctx context.Context) (*releaseInfo, error) {
	releases, err := s.fetchReleases(ctx)
	if err != nil {
		return nil, err
	}

	includePre := s.config().IncludePrerelease
	var best *ghRelease
	var bestVer string
	for i := range releases {
		r := &releases[i]
		if r.Draft {
			continue
		}
		if r.Prerelease && !includePre {
			continue
		}
		v := normalizeVersion(r.TagName)
		if !semver.IsValid(v) {
			continue
		}
		if best == nil || semver.Compare(v, bestVer) > 0 {
			best = r
			bestVer = v
		}
	}
	if best == nil {
		return nil, refusedf("no applicable release found")
	}

	assets := make(map[string]ghAsset, len(best.Assets))
	for _, a := range best.Assets {
		assets[a.Name] = a
	}
	return &releaseInfo{
		tag:         normalizeVersion(best.TagName),
		version:     bestVer,
		notes:       best.Body,
		htmlURL:     best.HTMLURL,
		publishedAt: best.PublishedAt,
		assets:      assets,
	}, nil
}

// fetchReleases pulls the most recent releases (newest first). A modest
// per_page is plenty: we only need enough to find the newest applicable tag.
func (s *Service) fetchReleases(ctx context.Context) ([]ghRelease, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	endpoint := fmt.Sprintf("%s/repos/%s/%s/releases?per_page=20", githubAPI, s.owner, s.repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, internalErr("could not build github request", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", userAgent)

	resp, err := s.httpClient().Do(req)
	if err != nil {
		return nil, upstreamErr(fmt.Errorf("contact github: %w", err))
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Read a little of the body for context, but keep the message generic.
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		return nil, upstreamErr(fmt.Errorf("github returned HTTP %d", resp.StatusCode))
	}

	var releases []ghRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&releases); err != nil {
		return nil, upstreamErr(fmt.Errorf("decode github response: %w", err))
	}
	return releases, nil
}
