package update

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/txperl/PixivBiu/internal/config"
)

func TestIsDevVersion(t *testing.T) {
	cases := map[string]bool{
		"0.1.0-dev":             true,  // the built-in default
		"":                      true,  // unset
		"v2.6.4b":               true,  // legacy, not valid semver
		"0.0.0-snapshot-abc123": true,  // goreleaser --snapshot
		"3.0.0-5-gdeadbee":      true,  // git describe between tags
		"3.0.0-dirty":           true,  // dirty worktree
		"3.0.0":                 false, // clean release
		"v3.0.0":                false, // clean release with v
		"3.1.0-beta.1":          false, // prerelease channel
		"3.1.0-rc.2":            false, // prerelease channel
		"v3.1.0-alpha":          false, // prerelease channel
	}
	for v, want := range cases {
		if got := isDevVersion(v); got != want {
			t.Errorf("isDevVersion(%q) = %v, want %v", v, got, want)
		}
	}
}

func TestAssetName(t *testing.T) {
	// The version's leading "v" must be stripped to match GoReleaser's .Version.
	got := assetName("v3.0.0")
	if got == "" || got[:9] != "PixivBiu_" {
		t.Fatalf("assetName = %q, want PixivBiu_… prefix", got)
	}
}

// mockReleases serves a GitHub /releases response built from the given list.
func mockReleases(t *testing.T, releases []ghRelease) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Errorf("request missing User-Agent header")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(releases)
	}))
}

func newTestService(t *testing.T, current string, includePre bool, url string) *Service {
	t.Helper()
	orig := githubAPI
	githubAPI = url
	t.Cleanup(func() { githubAPI = orig })
	return NewService(current, "txperl", "PixivBiu", config.UpdateConfig{
		Enabled:           true,
		IncludePrerelease: includePre,
		Interval:          time.Hour,
	}, "")
}

// withAssets attaches the archive for the running platform plus checksums.txt
// to r, so Check treats the release as installable here (mirrors a real
// GoReleaser release). The names are built from assetName so the fixture stays
// correct on whatever OS/arch the test runs on.
func withAssets(r ghRelease) ghRelease {
	name := assetName(r.TagName)
	r.Assets = []ghAsset{
		{Name: name, BrowserDownloadURL: "https://example/" + name},
		{Name: "checksums.txt", BrowserDownloadURL: "https://example/checksums.txt"},
	}
	return r
}

func TestCheckUpdateAvailable(t *testing.T) {
	ts := mockReleases(t, []ghRelease{
		{TagName: "v3.0.0", HTMLURL: "https://example/v3.0.0"},
		withAssets(ghRelease{TagName: "v3.1.0", HTMLURL: "https://example/v3.1.0"}),
		{TagName: "v2.6.4b"}, // legacy non-semver, must be ignored
	})
	defer ts.Close()

	s := newTestService(t, "3.0.0", false, ts.URL)
	st, err := s.Check(context.Background())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if st.LatestVersion != "v3.1.0" {
		t.Errorf("LatestVersion = %q, want v3.1.0", st.LatestVersion)
	}
	if !st.UpdateAvailable {
		t.Error("UpdateAvailable = false, want true")
	}
	if st.IsDev {
		t.Error("IsDev = true, want false for a clean release build")
	}
}

func TestCheckPrereleaseFiltering(t *testing.T) {
	releases := []ghRelease{
		{TagName: "v3.0.0", HTMLURL: "https://example/v3.0.0", Prerelease: false},
		withAssets(ghRelease{TagName: "v3.2.0-beta.1", HTMLURL: "https://example/beta", Prerelease: true}),
	}

	// Stable channel: the beta is invisible, so 3.0.0 is "latest" and we're current.
	ts := mockReleases(t, releases)
	defer ts.Close()
	s := newTestService(t, "3.0.0", false, ts.URL)
	st, err := s.Check(context.Background())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if st.LatestVersion != "v3.0.0" {
		t.Errorf("stable channel LatestVersion = %q, want v3.0.0", st.LatestVersion)
	}
	if st.UpdateAvailable {
		t.Error("stable channel UpdateAvailable = true, want false")
	}

	// Prerelease channel: the beta becomes visible and is newer.
	ts2 := mockReleases(t, releases)
	defer ts2.Close()
	s2 := newTestService(t, "3.0.0", true, ts2.URL)
	st2, err := s2.Check(context.Background())
	if err != nil {
		t.Fatalf("Check (prerelease): %v", err)
	}
	if st2.LatestVersion != "v3.2.0-beta.1" {
		t.Errorf("prerelease channel LatestVersion = %q, want v3.2.0-beta.1", st2.LatestVersion)
	}
	if !st2.UpdateAvailable {
		t.Error("prerelease channel UpdateAvailable = false, want true")
	}
}

func TestCheckDevBuildNeverOffersUpdate(t *testing.T) {
	ts := mockReleases(t, []ghRelease{
		{TagName: "v9.9.9", HTMLURL: "https://example/v9.9.9"},
	})
	defer ts.Close()

	s := newTestService(t, "0.1.0-dev", false, ts.URL)
	st, err := s.Check(context.Background())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !st.IsDev {
		t.Error("IsDev = false, want true for a dev build")
	}
	if st.UpdateAvailable {
		t.Error("UpdateAvailable = true, want false for a dev build")
	}
	// The latest version is still surfaced for display.
	if st.LatestVersion != "v9.9.9" {
		t.Errorf("LatestVersion = %q, want v9.9.9", st.LatestVersion)
	}
}

// A newer release is only advertised as available when it actually ships an
// installable artifact for this platform (archive + checksums.txt); otherwise
// Apply would refuse it. The latest version is still surfaced for display, but
// without an offer or an asset name.
func TestCheckOnlyOffersApplicableReleases(t *testing.T) {
	const v = "v3.1.0"
	archive := ghAsset{Name: assetName(v), BrowserDownloadURL: "https://example/a"}
	sums := ghAsset{Name: "checksums.txt", BrowserDownloadURL: "https://example/c"}

	cases := map[string]struct {
		assets        []ghAsset
		wantAvailable bool
	}{
		"archive and checksums":    {[]ghAsset{archive, sums}, true},
		"archive but no checksums": {[]ghAsset{archive}, false},
		"checksums but no archive": {[]ghAsset{sums}, false},
		"no assets at all":         {nil, false},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			ts := mockReleases(t, []ghRelease{
				{TagName: "v3.0.0"},
				{TagName: v, HTMLURL: "https://example/v3.1.0", Assets: c.assets},
			})
			defer ts.Close()

			s := newTestService(t, "3.0.0", false, ts.URL)
			st, err := s.Check(context.Background())
			if err != nil {
				t.Fatalf("Check: %v", err)
			}
			if st.LatestVersion != v {
				t.Errorf("LatestVersion = %q, want %q (always surfaced)", st.LatestVersion, v)
			}
			if st.UpdateAvailable != c.wantAvailable {
				t.Errorf("UpdateAvailable = %v, want %v", st.UpdateAvailable, c.wantAvailable)
			}
			// AssetName tracks availability: set only when the offer is real.
			if (st.AssetName != "") != c.wantAvailable {
				t.Errorf("AssetName = %q, want non-empty=%v", st.AssetName, c.wantAvailable)
			}
		})
	}
}

func TestCheckInterval(t *testing.T) {
	cases := []struct {
		in   time.Duration
		want time.Duration
	}{
		{0, 24 * time.Hour},                // unset → daily default
		{-5 * time.Second, 24 * time.Hour}, // invalid → daily default
		{30 * time.Second, time.Minute},    // valid sub-minute → clamped up to the floor, not daily
		{time.Minute, time.Minute},         // exactly the floor
		{6 * time.Hour, 6 * time.Hour},     // honored as-is
	}
	for _, c := range cases {
		if got := checkInterval(config.UpdateConfig{Interval: c.in}); got != c.want {
			t.Errorf("checkInterval(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestApplyRefusesDevBuild(t *testing.T) {
	s := NewService("0.1.0-dev", "txperl", "PixivBiu", config.UpdateConfig{}, "")
	err := s.Apply(context.Background())
	var ue *Error
	if !errors.As(err, &ue) || ue.Kind != KindRefused {
		t.Fatalf("Apply on a dev build = %v, want a KindRefused *Error", err)
	}
}

// A non-2xx from GitHub must classify as upstream so the API returns 502, not a
// 400 with raw text.
func TestCheckClassifiesGithubFailureAsUpstream(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer ts.Close()

	s := newTestService(t, "3.0.0", false, ts.URL)
	_, err := s.Check(context.Background())
	var ue *Error
	if !errors.As(err, &ue) || ue.Kind != KindUpstream {
		t.Fatalf("Check against a failing GitHub = %v, want a KindUpstream *Error", err)
	}
}

// "no applicable release" is a refusal (precondition), not a transport failure.
func TestCheckNoApplicableReleaseIsRefused(t *testing.T) {
	ts := mockReleases(t, []ghRelease{{TagName: "v2.6.4b"}}) // legacy non-semver only
	defer ts.Close()

	s := newTestService(t, "3.0.0", false, ts.URL)
	_, err := s.Check(context.Background())
	var ue *Error
	if !errors.As(err, &ue) || ue.Kind != KindRefused {
		t.Fatalf("Check with no semver release = %v, want a KindRefused *Error", err)
	}
}
