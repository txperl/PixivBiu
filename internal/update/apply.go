package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path"
	"runtime"
	"strings"
	"time"

	"github.com/minio/selfupdate"
	"golang.org/x/mod/semver"
)

// maxDownload caps how much we read for any single update asset, guarding
// against a runaway/oversized response. Release archives are a few tens of MB.
const maxDownload = 200 << 20 // 200 MiB

// Apply downloads the release archive built for this OS/arch, verifies its
// SHA-256 against the release's checksums.txt, extracts the binary, and swaps
// it into place at the running executable's path. On success the caller should
// restart the process (the existing reexec path) so the new binary takes over.
//
// It refuses to run on dev/non-release builds — replacing a `go run` temp or a
// locally-built binary is meaningless and unsafe.
func (s *Service) Apply(ctx context.Context) error {
	// Single-flight: Apply rewrites the running executable, so only one may run
	// at a time — two concurrent selfupdate.Apply calls could rename/rollback the
	// same binary into an inconsistent state. Reject a second request instead. On
	// success the process is about to restart, so the flag is intentionally left
	// set (a second apply would be pointless); only a failure clears it so the
	// user can retry.
	if !s.applying.CompareAndSwap(false, true) {
		return conflictf("an update is already being applied")
	}
	applied := false
	defer func() {
		if !applied {
			s.applying.Store(false)
		}
	}()

	if isDevVersion(s.current) {
		return refusedf("refusing to self-update a development build (%s); install a release binary first", s.current)
	}

	// resolveLatest already returns categorized errors (upstream / refused).
	ri, err := s.resolveLatest(ctx)
	if err != nil {
		return err
	}
	if semver.Compare(ri.version, normalizeVersion(s.current)) <= 0 {
		return refusedf("already on the latest version (%s)", s.current)
	}

	name := assetName(ri.version)
	asset, ok := ri.assets[name]
	if !ok {
		return refusedf("release %s has no asset for this platform (%s)", ri.tag, name)
	}
	sumAsset, ok := ri.assets["checksums.txt"]
	if !ok {
		return refusedf("release %s is missing checksums.txt; cannot verify download", ri.tag)
	}

	// fetchChecksum / download return categorized errors (upstream on a
	// transport/HTTP failure, refused when the asset is absent from the list).
	want, err := s.fetchChecksum(ctx, sumAsset.BrowserDownloadURL, name)
	if err != nil {
		return err
	}

	archive, err := s.download(ctx, asset.BrowserDownloadURL)
	if err != nil {
		return err
	}

	got := sha256.Sum256(archive)
	if hex.EncodeToString(got[:]) != want {
		return refusedf("checksum mismatch for %s: refusing to apply", name)
	}

	bin, err := extractBinary(name, archive)
	if err != nil {
		return internalErr("could not extract the update archive", err)
	}

	if err := selfupdate.Apply(bytes.NewReader(bin), selfupdate.Options{}); err != nil {
		if rerr := selfupdate.RollbackError(err); rerr != nil {
			return internalErr("could not replace the binary and rollback failed", fmt.Errorf("%w (rollback: %v)", err, rerr))
		}
		return internalErr("could not replace the binary", err)
	}
	applied = true
	return nil
}

// binaryName is the executable's name inside the GoReleaser archive
// (.goreleaser.yaml `binary: pixivbiu`), with the platform extension.
func binaryName() string {
	if runtime.GOOS == "windows" {
		return "pixivbiu.exe"
	}
	return "pixivbiu"
}

// download fetches url fully into memory under a generous deadline. Archives
// are small enough that buffering avoids a temp-file dance; selfupdate streams
// the extracted binary from the buffer.
func (s *Service) download(ctx context.Context, url string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, internalErr("could not build download request", err)
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := s.httpClient().Do(req)
	if err != nil {
		return nil, upstreamErr(fmt.Errorf("download %s: %w", url, err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, upstreamErr(fmt.Errorf("download %s: HTTP %d", url, resp.StatusCode))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDownload))
	if err != nil {
		return nil, upstreamErr(fmt.Errorf("read %s: %w", url, err))
	}
	return body, nil
}

// fetchChecksum downloads checksums.txt and returns the lowercase hex SHA-256
// recorded for assetName. Each line is "<sha256>  <filename>" (GoReleaser).
func (s *Service) fetchChecksum(ctx context.Context, url, assetName string) (string, error) {
	data, err := s.download(ctx, url) // already categorized (upstream on failure)
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		if fields[1] == assetName {
			return strings.ToLower(fields[0]), nil
		}
	}
	return "", refusedf("checksums.txt has no entry for %s", assetName)
}

// extractBinary returns the PixivBiu executable bytes from a release archive.
// archiveName's extension selects the format: .zip (Windows) or .tar.gz.
func extractBinary(archiveName string, data []byte) ([]byte, error) {
	if strings.HasSuffix(archiveName, ".zip") {
		return extractFromZip(data)
	}
	return extractFromTarGz(data)
}

// readCapped reads all of r but refuses a stream larger than limit. It reads one
// byte past the cap so a member larger than it is detected and rejected rather
// than silently truncated (a member of exactly limit bytes is still returned
// whole). Extraction must never hand a partial binary to selfupdate.Apply: the
// checksum covers the archive, not the extracted file, so a truncated member
// would otherwise pass verification and corrupt the install.
func readCapped(r io.Reader, limit int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("binary exceeds the %d MiB limit", limit>>20)
	}
	return b, nil
}

func extractFromTarGz(data []byte) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("open gzip: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	want := binaryName()
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read tar: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg || path.Base(hdr.Name) != want {
			continue
		}
		return readCapped(tr, maxDownload)
	}
	return nil, fmt.Errorf("archive does not contain %s", want)
}

func extractFromZip(data []byte) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	want := binaryName()
	for _, f := range zr.File {
		if path.Base(f.Name) != want {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("open %s in zip: %w", want, err)
		}
		defer rc.Close()
		return readCapped(rc, maxDownload)
	}
	return nil, fmt.Errorf("archive does not contain %s", want)
}
