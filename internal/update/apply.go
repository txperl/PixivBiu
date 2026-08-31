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
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/minio/selfupdate"
	"golang.org/x/mod/semver"
)

// maxDownload caps how much we read for any single update asset, guarding
// against a runaway/oversized response. Release archives are a few tens of MB.
const maxDownload = 200 << 20 // 200 MiB

// Apply downloads the release archive built for this OS/arch, verifies its
// SHA-256 against the release's checksums.txt (whose minisign signature is
// verified first on official builds), extracts the binary, and swaps it into
// place at the running executable's path. On success the caller should
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
	a, ok := ri.assets[name]
	if !ok {
		return refusedf("release %s has no asset for this platform (%s)", ri.tag, name)
	}

	// fetchExpectedChecksum / download return categorized errors (upstream on a
	// transport/HTTP failure, refused when an asset is missing or the checksums
	// signature doesn't verify on a signature-enforcing build).
	want, err := s.fetchExpectedChecksum(ctx, ri, name)
	if err != nil {
		return err
	}

	archive, err := s.download(ctx, a.BrowserDownloadURL)
	if err != nil {
		return err
	}

	got := sha256.Sum256(archive)
	if hex.EncodeToString(got[:]) != want {
		return refusedf("checksum mismatch for %s: refusing to apply", name)
	}

	// preferred is the running executable's own base name. It disambiguates the
	// archive's binary when several executables are bundled (the member named
	// like us wins); best-effort, so an os.Executable failure just leaves the
	// sole-executable fallback to do the job.
	preferred := ""
	if exe, err := os.Executable(); err == nil {
		preferred = filepath.Base(exe)
	}

	bin, err := extractBinary(name, archive, preferred)
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

// download fetches url fully into memory under a generous deadline. Archives
// are small enough that buffering avoids a temp-file dance; selfupdate streams
// the extracted binary from the buffer. It shares fetchBytes' transport + error
// categorization, adding only the larger archive cap and a 5-minute ceiling (the
// release-list check uses the caller's shorter context instead).
func (s *Service) download(ctx context.Context, url string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	return s.fetchBytes(ctx, url, maxDownload)
}

// extractBinary returns the application's executable bytes from a release
// archive. archiveName's extension selects the format: .zip (Windows) or
// .tar.gz. The binary is found by name-independent structure — the .exe files
// (zip) or execute-bit files (tar) — then disambiguated by `preferred` (the
// running executable's own base name): the member named like us wins, so an
// archive that bundles several executables still resolves to the app binary.
// With no match (preferred empty, or the binary was renamed since the running
// build shipped) it falls back to the lone executable, and refuses if several
// are present but none matches — never guessing which is the app binary. This
// keeps self-update working across a binary rename without picking the wrong
// file out of a multi-executable archive.
func extractBinary(archiveName string, data []byte, preferred string) ([]byte, error) {
	if strings.HasSuffix(archiveName, ".zip") {
		return extractFromZip(data, preferred)
	}
	return extractFromTarGz(data, preferred)
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

func extractFromTarGz(data []byte, preferred string) ([]byte, error) {
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("open gzip: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	var (
		candidates []string // base names of every executable member, for diagnostics
		soleBytes  []byte   // bytes of the first executable, used iff it is the only one
	)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read tar: %w", err)
		}
		// Executable members are identified by an execute bit, not a name:
		// GoReleaser ships the binary 0755 and the bundled docs (README/LICENSE/
		// CHANGELOG) 0644.
		if hdr.Typeflag != tar.TypeReg || hdr.FileInfo().Mode().Perm()&0o111 == 0 {
			continue
		}
		base := path.Base(hdr.Name)
		if strings.EqualFold(base, preferred) {
			return readCapped(tr, maxDownload) // member named like us wins outright
		}
		candidates = append(candidates, base)
		if len(candidates) == 1 {
			// Hold the first candidate for the single-executable fallback; a second
			// makes the choice ambiguous and these bytes go unused.
			if soleBytes, err = readCapped(tr, maxDownload); err != nil {
				return nil, err
			}
		}
	}
	switch len(candidates) {
	case 0:
		return nil, fmt.Errorf("archive contains no executable binary")
	case 1:
		return soleBytes, nil
	default:
		return nil, fmt.Errorf("archive bundles multiple executables %v but none is named %q", candidates, preferred)
	}
}

func extractFromZip(data []byte, preferred string) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	// Executable members in a Windows archive are the .exe files; the bundled
	// docs (README/LICENSE/CHANGELOG) never are.
	var (
		candidates []string
		sole       *zip.File
	)
	for _, f := range zr.File {
		base := path.Base(f.Name)
		if !strings.HasSuffix(strings.ToLower(base), ".exe") {
			continue
		}
		if strings.EqualFold(base, preferred) {
			return openZipFile(f) // member named like us wins outright
		}
		candidates = append(candidates, base)
		if sole == nil {
			sole = f
		}
	}
	switch len(candidates) {
	case 0:
		return nil, fmt.Errorf("archive contains no .exe binary")
	case 1:
		return openZipFile(sole)
	default:
		return nil, fmt.Errorf("archive bundles multiple .exe binaries %v but none is named %q", candidates, preferred)
	}
}

func openZipFile(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("open %s in zip: %w", path.Base(f.Name), err)
	}
	defer rc.Close()
	return readCapped(rc, maxDownload)
}
