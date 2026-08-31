package update

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// githubAPI is the releases endpoint base. A var (not const) so tests can point
// it at an httptest server.
var githubAPI = "https://api.github.com"

// ghRelease is the subset of the GitHub release object we consume. The
// `prerelease` flag is deliberately not mapped: channel filtering keys off the
// tag suffix (releaseRank in checker.go), never GitHub's boolean.
type ghRelease struct {
	TagName     string    `json:"tag_name"`
	Body        string    `json:"body"`
	Draft       bool      `json:"draft"`
	HTMLURL     string    `json:"html_url"`
	PublishedAt time.Time `json:"published_at"`
	Assets      []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// maxReleasesBody caps the release-list response: 20 releases with long
// changelog bodies and a dozen assets each stay well under this, and the cap
// bounds a runaway/oversized response.
const maxReleasesBody = 4 << 20 // 4 MiB

// fetchReleases pulls the most recent releases (newest first) from the GitHub
// Releases API. The request is unauthenticated — the anonymous 60 req/h/IP
// budget is ample for the 3-hour cadence plus manual checks; a rate-limit 403
// surfaces as upstream and the next cycle retries. The page size also bounds
// how far back aggregateNotes can stitch changelogs for a multi-version jump
// (20 covers any realistic gap between checks for this cadence).
func (s *Service) fetchReleases(ctx context.Context) ([]ghRelease, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	endpoint := fmt.Sprintf("%s/repos/%s/%s/releases?per_page=20", githubAPI, s.owner, s.repo)
	data, err := s.fetchBytes(ctx, endpoint, maxReleasesBody)
	if err != nil {
		return nil, err
	}
	var releases []ghRelease
	if err := json.Unmarshal(data, &releases); err != nil {
		return nil, upstreamErr(fmt.Errorf("decode github response: %w", err))
	}
	return releases, nil
}

// fetchBytes GETs url under the caller's context, rejecting a non-200 or a body
// larger than limit. Transport/HTTP failures are categorized as upstream. Used
// for the release-list API call and for raw release assets (archives,
// checksums.txt, signatures) alike — the Accept header only matters to the API
// endpoint, and asset downloads (browser_download_url, redirected to GitHub's
// asset storage by the default client policy) ignore it.
func (s *Service) fetchBytes(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, internalErr("could not build update request", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", userAgent)

	resp, err := s.httpClient().Do(req)
	if err != nil {
		return nil, upstreamErr(fmt.Errorf("fetch %s: %w", url, err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		return nil, upstreamErr(fmt.Errorf("fetch %s: HTTP %d", url, resp.StatusCode))
	}
	// Read one byte past the cap so an oversized response is rejected rather
	// than silently truncated. A body exactly at the limit remains valid.
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, upstreamErr(fmt.Errorf("read %s: %w", url, err))
	}
	if int64(len(body)) > limit {
		return nil, upstreamErr(fmt.Errorf("read %s: response exceeds the %d-byte limit", url, limit))
	}
	return body, nil
}
