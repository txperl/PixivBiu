package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"testing"

	"aead.dev/minisign"

	"github.com/txperl/PixivBiu/internal/config"
)

// Apply is single-flight: a second call while one is already in progress is
// rejected as a conflict instead of racing two binary swaps on the same
// executable.
func TestApplyRejectsConcurrent(t *testing.T) {
	s := NewService("3.0.0", testOwner, testRepo, nil, config.UpdateConfig{}, "")
	s.applying.Store(true) // simulate an apply already running
	err := s.Apply(context.Background())
	var ue *Error
	if !errors.As(err, &ue) || ue.Kind != KindConflict {
		t.Fatalf("concurrent Apply = %v, want a KindConflict *Error", err)
	}
}

// applyTag is the release every Apply fixture serves; current is pinned to
// 3.0.0 so the release is always a strict upgrade.
const applyTag = "v3.1.0"

// newApplyService wires a Service to a fake GitHub API serving one v3.1.0
// release carrying the platform archive and checksums.txt with the given
// bodies. sig == nil omits the signature asset entirely (an unsigned release);
// otherwise it is served as checksums.txt.minisig. keys select the trust mode,
// as in newTestService.
func newApplyService(t *testing.T, archive, sums, sig []byte, keys ...string) *Service {
	t.Helper()
	name := assetName(applyTag)
	assets := map[string][]byte{
		"/dl/" + name:               archive,
		"/dl/" + checksumsAssetName: sums,
	}
	rel := ghRelease{TagName: applyTag, Assets: []ghAsset{
		{Name: name, BrowserDownloadURL: "/dl/" + name},
		{Name: checksumsAssetName, BrowserDownloadURL: "/dl/" + checksumsAssetName},
	}}
	if sig != nil {
		assets["/dl/"+checksumsSigAssetName] = sig
		rel.Assets = append(rel.Assets, ghAsset{
			Name: checksumsSigAssetName, BrowserDownloadURL: "/dl/" + checksumsSigAssetName,
		})
	}
	serveGitHub(t, []ghRelease{rel}, assets)
	return NewService("3.0.0", testOwner, testRepo, keys, config.UpdateConfig{Enabled: true, Channel: "stable"}, "")
}

// wrongSums claims an all-zero SHA-256 for the platform archive — valid-length
// hex that can never match real bytes.
func wrongSums() []byte {
	return []byte(strings.Repeat("0", 64) + "  " + assetName(applyTag) + "\n")
}

// Apply must refuse to install an archive whose SHA-256 doesn't match
// checksums.txt — a mismatch means corruption or tampering. This drives the
// full unsigned-mode path: list releases, resolve the asset, fetch checksums,
// download the archive, compare hashes.
func TestApplyChecksumMismatch(t *testing.T) {
	s := newApplyService(t, []byte("not a real archive"), wrongSums(), nil)
	err := s.Apply(context.Background())
	var ue *Error
	if !errors.As(err, &ue) || ue.Kind != KindRefused {
		t.Fatalf("Apply with a checksum mismatch = %v, want a KindRefused *Error", err)
	}
	if !strings.Contains(strings.ToLower(ue.Message), "checksum mismatch") {
		t.Errorf("message = %q, want it to mention a checksum mismatch", ue.Message)
	}
}

// checksums.txt without an entry for the platform archive is a refusal: there
// is nothing to verify the download against.
func TestApplyChecksumsMissingEntry(t *testing.T) {
	sums := []byte(strings.Repeat("0", 64) + "  some-other-file.tar.gz\n")
	s := newApplyService(t, []byte("irrelevant"), sums, nil)
	err := s.Apply(context.Background())
	var ue *Error
	if !errors.As(err, &ue) || ue.Kind != KindRefused {
		t.Fatalf("Apply with no checksum entry = %v, want a KindRefused *Error", err)
	}
	if !strings.Contains(ue.Message, "no entry") {
		t.Errorf("message = %q, want it to mention the missing entry", ue.Message)
	}
}

// On a signature-enforcing build, a validly-signed checksums.txt is accepted
// and Apply proceeds to the download — proven by failing later on the checksum
// mismatch, past the signature gate.
func TestApplySignedChecksumsVerify(t *testing.T) {
	pub, priv, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	sums := wrongSums()
	s := newApplyService(t, []byte("not a real archive"), sums, minisign.Sign(priv, sums), pub.String())
	aerr := s.Apply(context.Background())
	var ue *Error
	if !errors.As(aerr, &ue) || ue.Kind != KindRefused {
		t.Fatalf("Apply = %v, want a KindRefused *Error", aerr)
	}
	if !strings.Contains(strings.ToLower(ue.Message), "checksum mismatch") {
		t.Errorf("message = %q, want the checksum mismatch (i.e. the signature verified)", ue.Message)
	}
}

// A signature-enforcing build must refuse a release that carries no checksums
// signature at all — this is the official-build guarantee.
func TestApplyRefusesUnsignedRelease(t *testing.T) {
	pub, _, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	s := newApplyService(t, []byte("irrelevant"), wrongSums(), nil, pub.String())
	aerr := s.Apply(context.Background())
	var ue *Error
	if !errors.As(aerr, &ue) || ue.Kind != KindRefused {
		t.Fatalf("Apply of an unsigned release = %v, want a KindRefused *Error", aerr)
	}
	if !strings.Contains(ue.Message, "unsigned") {
		t.Errorf("message = %q, want it to mention the release is unsigned", ue.Message)
	}
}

// A checksums signature by an untrusted key must be refused — tampering with
// the checksums (even with a well-formed signature) cannot push an update.
func TestApplyRejectsInvalidSignature(t *testing.T) {
	trustedPub, _, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate trusted key: %v", err)
	}
	_, signingPriv, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	sums := wrongSums()
	s := newApplyService(t, []byte("irrelevant"), sums, minisign.Sign(signingPriv, sums), trustedPub.String())
	aerr := s.Apply(context.Background())
	var ue *Error
	if !errors.As(aerr, &ue) || ue.Kind != KindRefused {
		t.Fatalf("Apply with a bad signature = %v, want a KindRefused *Error", aerr)
	}
	if !strings.Contains(ue.Message, "signature is invalid") {
		t.Errorf("message = %q, want it to mention the invalid signature", ue.Message)
	}
}

// A stamped-but-malformed trusted key still fails closed: the build is
// signature-enforcing (requireSig comes from the raw stamped strings) but no
// key parsed, so nothing can ever verify — a typo must never silently demote an
// official build to unsigned mode.
func TestApplyMalformedTrustedKeyFailsClosed(t *testing.T) {
	_, priv, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	sums := wrongSums()
	s := newApplyService(t, []byte("irrelevant"), sums, minisign.Sign(priv, sums), "not-a-valid-minisign-key")
	aerr := s.Apply(context.Background())
	var ue *Error
	if !errors.As(aerr, &ue) || ue.Kind != KindRefused {
		t.Fatalf("Apply with a malformed trusted key = %v, want a KindRefused *Error", aerr)
	}
	if !strings.Contains(ue.Message, "no usable update signing key") {
		t.Errorf("message = %q, want the fail-closed no-usable-key refusal", ue.Message)
	}
}

func TestParseChecksum(t *testing.T) {
	sums := []byte("aaaa  first.tar.gz\nBBBB  second.zip\nmalformed line\n")
	if got, err := parseChecksum(sums, "second.zip"); err != nil || got != "bbbb" {
		t.Errorf("parseChecksum = (%q, %v), want (bbbb, nil) — lowercased hex", got, err)
	}
	if _, err := parseChecksum(sums, "missing.tar.gz"); err == nil {
		t.Error("parseChecksum for an absent entry = nil error; want a refusal")
	}
}

// readCapped must reject a stream larger than the cap rather than silently
// truncating it: the archive checksum doesn't cover the extracted binary, so a
// truncated member would otherwise be applied as a corrupt executable.
func TestReadCapped(t *testing.T) {
	// Larger than the cap → error, no partial data.
	if b, err := readCapped(bytes.NewReader(make([]byte, 11)), 10); err == nil {
		t.Errorf("readCapped(11, limit 10) = %d bytes, nil error; want oversize error", len(b))
	}
	// Exactly at the cap → returned whole (not truncated).
	if b, err := readCapped(bytes.NewReader(make([]byte, 10)), 10); err != nil || len(b) != 10 {
		t.Errorf("readCapped(10, limit 10) = (%d bytes, %v); want (10, nil)", len(b), err)
	}
	// Under the cap → returned verbatim.
	if b, err := readCapped(bytes.NewReader([]byte("hello")), 10); err != nil || string(b) != "hello" {
		t.Errorf("readCapped(5, limit 10) = (%q, %v); want (hello, nil)", b, err)
	}
}

type tarEntry struct {
	mode int64
	data []byte
}

func makeTarGz(t *testing.T, files map[string]tarEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, f := range files {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: f.mode, Size: int64(len(f.data)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatalf("write tar header: %v", err)
		}
		if _, err := tw.Write(f.data); err != nil {
			t.Fatalf("write tar data: %v", err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatalf("close tar: %v", err)
	}
	if err := gz.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
	return buf.Bytes()
}

func makeZip(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, data := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create zip entry: %v", err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatalf("write zip entry: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

// Extraction locates the binary structurally, not by a hardcoded filename: in a
// tar.gz it's the lone regular file with an execute bit (GoReleaser ships the
// binary 0755, docs 0644), so a binary rename can't break self-update.
func TestExtractBinaryTarGzPicksExecutable(t *testing.T) {
	bin := []byte("\x7fELF fake binary bytes")
	data := makeTarGz(t, map[string]tarEntry{
		"README.md": {mode: 0o644, data: []byte("# docs")},
		"PixivBiu":  {mode: 0o755, data: bin},
		"LICENSE":   {mode: 0o644, data: []byte("MIT")},
	})
	got, err := extractBinary("PixivBiu_3.1.0_linux_amd64.tar.gz", data, "PixivBiu")
	if err != nil {
		t.Fatalf("extractBinary: %v", err)
	}
	if !bytes.Equal(got, bin) {
		t.Errorf("extracted %q, want the executable bytes %q", got, bin)
	}
}

func TestExtractBinaryTarGzNoExecutable(t *testing.T) {
	data := makeTarGz(t, map[string]tarEntry{
		"README.md": {mode: 0o644, data: []byte("# docs")},
		"LICENSE":   {mode: 0o644, data: []byte("MIT")},
	})
	if _, err := extractBinary("x_linux_amd64.tar.gz", data, "PixivBiu"); err == nil {
		t.Fatal("extractBinary on a docs-only archive = nil error; want an error")
	}
}

// In a Windows zip the binary is the sole .exe; docs never are. Match on the
// extension, not a literal name.
func TestExtractBinaryZipPicksExe(t *testing.T) {
	bin := []byte("MZ fake windows binary")
	data := makeZip(t, map[string][]byte{
		"README.md":    []byte("# docs"),
		"PixivBiu.exe": bin,
	})
	got, err := extractBinary("PixivBiu_3.1.0_windows_amd64.zip", data, "PixivBiu.exe")
	if err != nil {
		t.Fatalf("extractBinary: %v", err)
	}
	if !bytes.Equal(got, bin) {
		t.Errorf("extracted %q, want the exe bytes %q", got, bin)
	}
}

func TestExtractBinaryZipNoExe(t *testing.T) {
	data := makeZip(t, map[string][]byte{
		"README.md": []byte("# docs"),
		"LICENSE":   []byte("MIT"),
	})
	if _, err := extractBinary("x_windows_amd64.zip", data, "PixivBiu.exe"); err == nil {
		t.Fatal("extractBinary on an exe-less zip = nil error; want an error")
	}
}

// With several executables bundled, the member named like the running binary
// (preferred) wins — not whichever happens to come first.
func TestExtractBinaryTarGzMultiplePrefersNamed(t *testing.T) {
	want := []byte("\x7fELF the real app binary")
	data := makeTarGz(t, map[string]tarEntry{
		"README.md":    {mode: 0o644, data: []byte("# docs")},
		"helper":       {mode: 0o755, data: []byte("\x7fELF a bundled helper")},
		"PixivBiu":     {mode: 0o755, data: want},
		"post-install": {mode: 0o755, data: []byte("#!/bin/sh\n")},
	})
	got, err := extractBinary("PixivBiu_3.1.0_linux_amd64.tar.gz", data, "PixivBiu")
	if err != nil {
		t.Fatalf("extractBinary: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("extracted %q, want the PixivBiu bytes %q", got, want)
	}
}

func TestExtractBinaryZipMultiplePrefersNamed(t *testing.T) {
	want := []byte("MZ the real app binary")
	data := makeZip(t, map[string][]byte{
		"README.md":    []byte("# docs"),
		"helper.exe":   []byte("MZ a bundled helper"),
		"PixivBiu.exe": want,
	})
	got, err := extractBinary("PixivBiu_3.1.0_windows_amd64.zip", data, "PixivBiu.exe")
	if err != nil {
		t.Fatalf("extractBinary: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("extracted %q, want the PixivBiu.exe bytes %q", got, want)
	}
}

// A binary renamed since the running build shipped: no member matches preferred,
// but there is exactly one executable, so the fallback installs it.
func TestExtractBinaryTarGzRenamedFallsBackToSole(t *testing.T) {
	want := []byte("\x7fELF renamed binary")
	data := makeTarGz(t, map[string]tarEntry{
		"README.md": {mode: 0o644, data: []byte("# docs")},
		"PixivPro":  {mode: 0o755, data: want},
	})
	got, err := extractBinary("PixivPro_4.0.0_linux_amd64.tar.gz", data, "PixivBiu")
	if err != nil {
		t.Fatalf("extractBinary: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Errorf("extracted %q, want the sole executable %q", got, want)
	}
}

// Several executables and none named like us: refuse rather than guess.
func TestExtractBinaryTarGzAmbiguousErrors(t *testing.T) {
	data := makeTarGz(t, map[string]tarEntry{
		"alpha": {mode: 0o755, data: []byte("\x7fELF a")},
		"beta":  {mode: 0o755, data: []byte("\x7fELF b")},
	})
	if _, err := extractBinary("x_linux_amd64.tar.gz", data, "PixivBiu"); err == nil {
		t.Fatal("extractBinary on an ambiguous multi-executable archive = nil error; want an error")
	}
}

func TestExtractBinaryZipAmbiguousErrors(t *testing.T) {
	data := makeZip(t, map[string][]byte{
		"alpha.exe": []byte("MZ a"),
		"beta.exe":  []byte("MZ b"),
	})
	if _, err := extractBinary("x_windows_amd64.zip", data, "PixivBiu.exe"); err == nil {
		t.Fatal("extractBinary on an ambiguous multi-.exe archive = nil error; want an error")
	}
}
