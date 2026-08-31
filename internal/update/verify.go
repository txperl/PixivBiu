package update

import (
	"context"
	"strings"
	"time"

	"aead.dev/minisign"
)

// GoReleaser publishes one SHA-256 checksums file per release plus, on official
// builds, its detached minisign signature (see `signs` in .goreleaser.yaml).
// The names are contractual: Check gates on their presence and Apply fetches
// them verbatim.
const (
	checksumsAssetName    = "checksums.txt"
	checksumsSigAssetName = "checksums.txt.minisig"
)

// Read caps for the verification assets: checksums.txt is a handful of lines
// and a minisign signature a few hundred bytes; these bound a runaway/oversized
// response.
const (
	maxChecksums = 1 << 20 // 1 MiB
	maxSignature = 8 << 10 // 8 KiB
)

// parsePublicKeys parses minisign public-key strings (base64, the line after the
// untrusted-comment line) into keys, silently dropping any that don't parse — a
// build-time typo in a baked-in key then just leaves the updater fail-closed
// (requireSig is derived from the raw strings, so a typo can never demote an
// official build to unsigned mode). Called once from NewService.
func parsePublicKeys(keys []string) []minisign.PublicKey {
	out := make([]minisign.PublicKey, 0, len(keys))
	for _, ks := range keys {
		var pk minisign.PublicKey
		if err := pk.UnmarshalText([]byte(ks)); err == nil {
			out = append(out, pk)
		}
	}
	return out
}

// fetchExpectedChecksum returns the SHA-256 the release publishes for asset
// name. It downloads the release's checksums.txt and, on signature-enforcing
// builds, its detached minisign signature, refusing to trust the checksums
// unless the signature verifies. Unstamped builds (forks, local `make build`)
// skip the signature and rely on HTTPS to GitHub plus the checksum alone —
// the pre-signing trust model, kept so a fork works without provisioning keys.
func (s *Service) fetchExpectedChecksum(ctx context.Context, ri *releaseInfo, name string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()

	sumAsset, ok := ri.assets[checksumsAssetName]
	if !ok {
		return "", refusedf("release %s is missing %s; cannot verify download", ri.tag, checksumsAssetName)
	}
	sums, err := s.fetchBytes(ctx, sumAsset.BrowserDownloadURL, maxChecksums)
	if err != nil {
		return "", err
	}

	if s.requireSig {
		sigAsset, ok := ri.assets[checksumsSigAssetName]
		if !ok {
			return "", refusedf("release %s is unsigned (missing %s); this build only installs signed releases", ri.tag, checksumsSigAssetName)
		}
		sig, err := s.fetchBytes(ctx, sigAsset.BrowserDownloadURL, maxSignature)
		if err != nil {
			return "", err
		}
		if err := s.verifyChecksums(sums, sig); err != nil {
			return "", err
		}
	}

	return parseChecksum(sums, name)
}

// verifyChecksums returns nil iff sig is a valid minisign signature of the
// checksums file under one of the trusted keys (parsed once at construction).
// Only called on signature-enforcing builds; with no usable key (every stamped
// key failed to parse) it fails closed — an unverifiable release must never be
// trusted, even by accident. minisign.Verify accepts both plain and prehashed
// (HashEdDSA) signatures, so a signature produced by the minisign CLI in CI
// verifies here unchanged.
func (s *Service) verifyChecksums(data, sig []byte) error {
	if len(s.trustedKeys) == 0 {
		return refusedf("no usable update signing key is configured; refusing to trust the release")
	}
	for _, pk := range s.trustedKeys {
		if minisign.Verify(pk, data, sig) {
			return nil
		}
	}
	return refusedf("%s signature is invalid; refusing to trust the release", checksumsAssetName)
}

// parseChecksum extracts the lowercase hex SHA-256 for name from a GoReleaser
// checksums file ("<sha256>  <filename>" lines).
func parseChecksum(data []byte, name string) (string, error) {
	for line := range strings.SplitSeq(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		if fields[1] == name {
			return strings.ToLower(fields[0]), nil
		}
	}
	return "", refusedf("%s has no entry for %s", checksumsAssetName, name)
}
