package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"golang.org/x/mod/semver"
)

// releaseRank ranks a release tag by maturity: stable > rc > beta > alpha.
// A higher rank is more stable. Unknown prerelease suffixes (-dev, -snapshot,
// a git-describe -N-gHASH, …) rank -1 so they are never offered as an update,
// consistent with isDevVersion treating them as dev builds.
func releaseRank(v string) int {
	switch pre := strings.ToLower(semver.Prerelease(v)); {
	case pre == "":
		return 3 // stable
	case strings.HasPrefix(pre, "-rc"):
		return 2
	case strings.HasPrefix(pre, "-beta"):
		return 1
	case strings.HasPrefix(pre, "-alpha"):
		return 0
	default:
		return -1
	}
}

// channelFloor maps an update channel to the minimum maturity rank it accepts.
// The model is cumulative: a riskier channel is a superset of the safer ones
// (beta also takes rc+stable; alpha takes everything). An unknown channel
// resolves to the stable floor (see resolveLatest).
var channelFloor = map[string]int{
	"stable": 3,
	"beta":   1,
	"alpha":  0,
}

// DefaultChannel returns the update channel a build should default to — the
// channel whose floor matches the build's own maturity, so a pre-release build
// keeps receiving its line's pre-releases out of the box while a stable/dev
// build stays on stable. It is the build-derived seed for app.update.channel;
// an explicit user override still wins. rc folds into beta (there is no rc-only
// channel, and beta's floor already accepts rc), mirroring channelFloor.
func DefaultChannel(version string) string {
	nv := normalizeVersion(version)
	if isDevVersion(nv) {
		return "stable"
	}
	switch releaseRank(nv) {
	case 0: // alpha
		return "alpha"
	case 1, 2: // beta, rc
		return "beta"
	default: // stable
		return "stable"
	}
}

// startupDelay holds the first automatic check briefly after boot so it doesn't
// compete with startup work (auth refresh, download resume).
const startupDelay = 10 * time.Second

// Start launches the background check loop in a goroutine. It performs an
// initial check shortly after boot, then re-checks every checkInterval (a fixed
// 3-hour cadence), skipping ticks while disabled (app.update.enabled), which it
// re-reads live each cycle so a config reload takes effect without a restart.
// The loop exits when ctx is cancelled.
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
			timer.Reset(checkInterval)
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

// resolveLatest returns the newest release at or above the current channel's
// maturity floor. Channels are cumulative (stable < beta < alpha): beta also
// accepts rc+stable, alpha accepts everything, and stable accepts only final
// releases — so semver.Compare still picks the single newest applicable tag and
// every channel converges onto stable releases when they're newest. Releases
// whose tag isn't valid semver (e.g. legacy "v2.6.4b") are skipped, as are
// unknown prerelease suffixes (releaseRank -1). An unknown channel falls back to
// the stable floor.
func (s *Service) resolveLatest(ctx context.Context) (*releaseInfo, error) {
	releases, err := s.fetchReleases(ctx)
	if err != nil {
		return nil, err
	}

	floor, ok := channelFloor[s.config().Channel]
	if !ok {
		floor = channelFloor["stable"]
	}
	var best *ghRelease
	var bestVer string
	for i := range releases {
		r := &releases[i]
		v, ok := applicableVersion(r, floor)
		if !ok {
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
		notes:       aggregateNotes(releases, floor, s.current),
		htmlURL:     best.HTMLURL,
		publishedAt: best.PublishedAt,
		assets:      assets,
	}, nil
}

// applicableVersion reports whether r is a release this channel can offer — not a
// draft, a valid semver tag, and at or above the channel's maturity floor — and
// returns its normalized version so callers reuse it without re-parsing. Shared by
// resolveLatest (which picks the single newest) and aggregateNotes (which collects
// the whole in-range set) so the predicate can't drift between them.
func applicableVersion(r *ghRelease, floor int) (string, bool) {
	if r.Draft {
		return "", false
	}
	v := normalizeVersion(r.TagName)
	if !semver.IsValid(v) || releaseRank(v) < floor {
		return "", false
	}
	return v, true
}

// Patterns that turn a GoReleaser release body into display-ready markdown. The
// app is the single authority for this normalization (see sanitizeReleaseBody);
// the frontend only renders.
var (
	// changelogHeadingRe matches GoReleaser's top-of-body "## Changelog" line.
	changelogHeadingRe = regexp.MustCompile(`(?im)^[ \t]*##[ \t]+Changelog[ \t]*$`)
	// bulletRe splits a list item into its "* " marker and the rest.
	bulletRe = regexp.MustCompile(`^(\s*[-*]\s+)(.*)$`)
	// commitShaRe matches a bullet's leading commit SHA, e.g. "12d8eaa…<hex>: ".
	commitShaRe = regexp.MustCompile(`(?i)^[0-9a-f]{7,40}:\s*`)
	// authorSuffixRe matches the trailing " (@handle)" GoReleaser appends.
	authorSuffixRe = regexp.MustCompile(`\s*\(@[\w-]+\)\s*$`)
)

// sanitizeReleaseBody turns a GoReleaser release body into display-ready markdown:
// it drops the leading "## Changelog" heading and, from each changelog bullet, the
// leading commit SHA and trailing "(@author)" — leaving the conventional
// "feat(scope): …" prose. The "View on GitHub" link still points at the raw body.
func sanitizeReleaseBody(body string) string {
	body = strings.TrimLeft(body, "\n")
	if loc := changelogHeadingRe.FindStringIndex(body); loc != nil && loc[0] == 0 {
		body = body[loc[1]:]
	}
	lines := strings.Split(body, "\n")
	for i, line := range lines {
		m := bulletRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		rest := commitShaRe.ReplaceAllString(m[2], "")
		rest = authorSuffixRe.ReplaceAllString(rest, "")
		lines[i] = m[1] + rest
	}
	return strings.TrimLeft(strings.Join(lines, "\n"), "\n")
}

// aggregateNotes builds the display-ready release-notes markdown for an update
// that may span several versions. It gathers every applicable release strictly
// newer than current, newest-first, sanitizes each body (sanitizeReleaseBody),
// and — when more than one version is in range — stitches them under per-version
// "## <tag>" headings, so a user who skipped intermediate versions sees all of
// their changelogs, not just the newest hop.
//
// When current is not valid semver (a dev build, where updates are never offered
// anyway) the lower bound is meaningless, so only the newest applicable release
// is kept.
func aggregateNotes(releases []ghRelease, floor int, current string) string {
	cur := normalizeVersion(current)

	var inRange []*ghRelease
	for i := range releases {
		r := &releases[i]
		v, ok := applicableVersion(r, floor)
		if !ok {
			continue
		}
		if semver.IsValid(cur) && semver.Compare(v, cur) <= 0 {
			continue
		}
		inRange = append(inRange, r)
	}
	if len(inRange) == 0 {
		return ""
	}
	sort.Slice(inRange, func(i, j int) bool {
		return semver.Compare(normalizeVersion(inRange[i].TagName), normalizeVersion(inRange[j].TagName)) > 0
	})

	// Nothing to stitch — one release, or a dev build with no usable lower bound:
	// just the newest body, sanitized, with no per-version heading.
	if len(inRange) == 1 || !semver.IsValid(cur) {
		return sanitizeReleaseBody(inRange[0].Body)
	}

	var b strings.Builder
	for i, r := range inRange {
		if i > 0 {
			b.WriteString("\n\n")
		}
		// "##" nests above GoReleaser's "### <group>" titles (Features / Bug fixes,
		// configured in .goreleaser.yaml); the frontend maps h2 -> version heading,
		// h3 -> group heading. Keep these three in sync.
		b.WriteString("## ")
		b.WriteString(normalizeVersion(r.TagName))
		b.WriteString("\n\n")
		b.WriteString(sanitizeReleaseBody(r.Body))
	}
	return b.String()
}

// fetchReleases pulls the most recent releases (newest first). The page also
// bounds how far back aggregateNotes can stitch changelogs for a multi-version
// jump; 20 covers any realistic gap between checks for this project's cadence.
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
