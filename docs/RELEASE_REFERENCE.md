# Release reference

Use the [release checklist](RELEASE.md) for first-time configuration, publishing, and failure recovery. This page holds the less frequent details: [artifacts](#artifacts), [channels](#channels), [update verification](#update-verification), [key rotation](#key-rotation), [forks](#forking-and-rebranding), [changelogs](#changelogs), and [local rehearsals](#local-rehearsal).

## Artifacts

### Core artifacts

[GoReleaser](../.goreleaser.yaml) cross-compiles with `CGO_ENABLED=0` for Linux/macOS/Windows × amd64/arm64. The SPA is embedded; the executable is `pixivbiu` (`pixivbiu.exe` on Windows). `main.version` is stamped with the version without its leading `v`.

```text
PixivBiu_<ver>_<os>_<arch>.tar.gz   # linux/darwin × amd64/arm64
PixivBiu_<ver>_windows_<arch>.zip   # amd64/arm64
checksums.txt                     # SHA-256 of archives
checksums.txt.minisig             # detached minisign signature of checksums.txt
```

The core updater reads assets from the GitHub Releases API; there is no separate update feed. Archive extraction first matches the running executable's basename against executable archive members, then falls back to a lone executable. Multiple unmatched candidates are refused. Preserve that selection contract when changing archive contents. Desktop owns the polished Windows icon/version-resource packaging.

Docker publishing runs independently from the binary release. Its [workflow](../.github/workflows/docker.yml) publishes `linux/amd64` and `linux/arm64` to GHCR; inspect the metadata step for the tags emitted for a particular release. Operators [replace the image](DOCKER.md#updating); the core has no container-specific apply no-op.

### Desktop artifacts

| OS | Arch | User installer | Auto-update assets | Signing |
| --- | --- | --- | --- | --- |
| macOS | arm64 and x64, separate | `.dmg` per arch | `.zip` + `.blockmap` per arch; `latest-mac.yml` | Developer ID + notarization |
| Windows | x64 | NSIS `.exe` | `.exe` + `.blockmap`; `latest.yml` | Azure Trusted Signing if configured |
| Linux | x64 | AppImage, `.deb`, `.rpm` | AppImage; `latest-linux.yml` | Unsigned |

AppImage has an embedded differential block map, not a separate `.AppImage.blockmap`. `.deb` and `.rpm` are install-only; their updates belong to the system package manager. macOS builds both architectures in one run, with a shared `latest-mac.yml`; electron-updater selects the architecture. Separate packages avoid doubling each download with a second core/runtime slice.

```text
PixivBiu-Desktop-<ver>-darwin-{arm64,x64}.{dmg,zip}
PixivBiu-Desktop-<ver>-windows-x64-setup.exe
PixivBiu-Desktop-<ver>-linux-{x86_64.AppImage,amd64.deb,x86_64.rpm}
latest-mac.yml | latest.yml | latest-linux.yml
```

Standalone `.blockmap` sidecars accompany the macOS and Windows update artifacts. There are no versionless installer aliases. The generated release description links to installers, identifies the source `desktop-v*` tag and bundled core release, and distinguishes update-only files from user downloads. Stable titles are `PixivBiu Desktop vX.Y.Z`; prereleases append `(Alpha)` or `(Beta)`.

The feed is the public, artifacts-only [PixivBiu-Desktop repository](https://github.com/txperl/PixivBiu-Desktop), using plain `vX.Y.Z` tags. Keep it separate from core releases: electron-updater's GitHub provider can select a core release lacking desktop update metadata if they share a repository. The `publish` block in [electron-builder.yml](../desktop/electron-builder.yml) sets both the publishing destination and the packaged `app-update.yml` feed.

## Channels

Both trains use strict semver, with dot-separated prerelease counters. The accepted suffixes differ:

| Maturity | Core source tag | Desktop source tag | Audience |
| --- | --- | --- | --- |
| Stable | `v3.0.0` | `desktop-v1.0.0` | Stable, beta, alpha |
| RC | `v3.1.0-rc.1` | Unsupported | Core beta and alpha |
| Beta | `v3.1.0-beta.1` | `desktop-v1.1.0-beta.1` | Beta and alpha |
| Alpha | `v3.1.0-alpha.1` | `desktop-v1.1.0-alpha.1` | Alpha |

### Core selection

`app.update.channel` defaults from the running build: stable/dev → stable, beta/RC → beta, alpha → alpha. Users can override it in [configuration](CONFIGURATION.md). Selection takes the semver-newest eligible release strictly newer than the installed version; drafts are excluded and maturity comes from the tag, not GitHub's prerelease checkbox.

For example, `3.0.0-beta.1` can receive `3.0.0-beta.2` on beta and then `3.0.0` on either beta or stable. An installed `3.0.0` on beta can receive `3.1.0-beta.1`, but cannot receive the lower `3.0.0-beta.2`. A stable release outranks prereleases of the same version.

Only `alpha`, `beta`, and `rc` suffixes are recognized. Other suffixes, including `dev`, `snapshot`, and git-describe suffixes, are treated as development versions: they are never offered and apply refuses them. Legacy tags such as `v2.6.4a` are not strict semver. See [checker.go](../internal/update/checker.go) for `DefaultChannel`, `releaseRank`, and channel filtering.

### Desktop selection

The channel follows the installed desktop version through electron-updater: stable installs follow stable; beta follows beta + stable; alpha follows all three. It does not use the core's `app.update.channel` setting. Newer stable versions remain eligible for prerelease users.

Only stable, `alpha`, and `beta` tags are accepted by the desktop workflow. The GitHub provider treats other prerelease identifiers, including `rc`, as custom channels with different selection behavior; do not introduce them. The workflow validates tags before creating a draft.

Metadata remains `latest*.yml` even for prereleases. The GitHub provider uses tags and prerelease flags for selection (and can fall back from a channel-specific metadata name to `latest.yml`). Stable publications are marked latest; prereleases leave GitHub's latest-release page on stable.

## Update verification

### Core trust model

Official core builds carry trusted minisign public keys in `main.updateTrustedKeysRaw`, stamped from `UPDATE_PUBLIC_KEYS` at build time. This trust anchor cannot be changed through runtime settings. The Release workflow validates key shape and secret/public pairing before publishing, then verifies the real checksum signature after publishing.

| Stage | What is checked |
| --- | --- |
| Update check | Required archive, checksum, and (when enforced) signature asset names exist |
| Apply | Verify `checksums.txt.minisig` with a compiled trusted key, then verify the downloaded archive's SHA-256 against that authenticated checksum file |

A missing required asset suppresses an update offer. An invalid signature may still be offered, but apply refuses it (`bad_request`/400). One signature authenticates all listed archive hashes. This protects against replaced assets only while the trusted signing key and signing pipeline remain uncompromised.

An empty key stamp permits HTTPS + SHA-256 verification without signature enforcement; a non-empty malformed stamp fails closed. Apply also requires a release-versioned build regardless of keys. Local Make builds default to `dev-<commit>` independently of Git tags; only an explicit `VERSION` override makes them release-versioned. Direct local GoReleaser releases still require an explicit `GORELEASER_CURRENT_TAG` when multiple tags share a commit.

### Desktop trust model

Desktop updates use electron-updater's metadata SHA-512 and platform code-signing checks, including the macOS signature; they do not use minisign. Windows signing depends on the optional Azure configuration. The shell disables the core's automatic check loop, and the desktop UI uses the shell updater.

The current [core staging script](../scripts/stage-core.sh) downloads and extracts GitHub assets without checking minisign signatures or checksums. The installed core's self-update verification is a separate path; it does not provide a staging guarantee. The desktop final publish job verifies asset completeness and metadata references, not the core's minisign signature.

### Verify a published archive

Use authenticated `gh`, `minisign`, and `shasum` (or Linux `sha256sum`). In a fresh directory, choose an existing release and its exact archive name. This macOS arm64 example downloads only the archive and checksum/signature pair:

```bash
tag=v3.1.0
archive=PixivBiu_3.1.0_darwin_arm64.tar.gz
gh release download "$tag" --repo txperl/PixivBiu --pattern "$archive" --pattern 'checksums.txt*'
minisign -Vm checksums.txt -P 'REPLACE_WITH_ONE_TRUSTED_PUBLIC_KEY'
shasum -a 256 -c checksums.txt --ignore-missing
```

Obtain the public key through a trusted channel, not from the same untrusted download. Pass one key to minisign, not a comma-separated rotation list. Stop on signature failure. The hash output must name your downloaded archive and report OK; missing files are skipped. On Linux, use `sha256sum -c checksums.txt --ignore-missing`. Do not extract/run the binary until verification succeeds.

## Key rotation

A client only trusts keys already compiled into it. Rotate without a source edit:

1. Add the new public key alongside the old one in `UPDATE_PUBLIC_KEYS`, comma-separated. Keep core and Docker scopes aligned.
2. Publish a bridge release **signed with the old key** and containing both public keys; allow time for users to install it.
3. Switch `MINISIGN_SECRET_KEY` to the new secret and publish subsequent releases with it.
4. Once new-key releases are established, remove the old public key from future builds if it should no longer be trusted.

Clients that skip the bridge cannot install new-key-only releases through the updater; maintain a manual upgrade path. Removing a key from future builds does not revoke it in existing installations. Back up signing keys privately: losing the old secret can prevent publishing a bridge those installations accept.

## Forking and rebranding

| Concern | Align these values |
| --- | --- |
| Core publishing vs update source | GoReleaser infers publishing from the git remote; edit `repoOwner` / `repoName` in [main.go](../cmd/server/main.go) so the binary also checks the fork |
| Core archive branding | Change both `project_name` in [.goreleaser.yaml](../.goreleaser.yaml) and the asset prefix in [update.go](../internal/update/update.go) |
| Desktop publishing vs update source | Set the dedicated public repo in both `publish` in [electron-builder.yml](../desktop/electron-builder.yml) and `DESKTOP_REPO` in [desktop.yml](../.github/workflows/desktop.yml) |
| Pinned core staging | CI passes its source repository as `CORE_REPO`; local staging defaults to `txperl/PixivBiu`, so override `CORE_REPO` for a fork |

For signed core releases, create your own keypair and follow [setup](RELEASE.md#core-signing). Multiple keys in `UPDATE_PUBLIC_KEYS` are comma-separated; release preflight normalizes incidental whitespace before stamping.

For deliberately checksum-only releases, leaving keys unset is insufficient: the unchanged workflow refuses publication. Adapt both its signing preflight/post-publish verification and GoReleaser's signing configuration, leave the compiled trust anchor empty, and point the update source at the fork. Docker reads the public-key build argument too; keep that build consistent with the chosen policy.

## Changelogs

Core notes are generated from commit subjects: `feat` → Features, `fix` → Bug fixes, `refactor` → Refactors, other included commits → Others. The current filters exclude unscoped `docs:`, `test:`, `chore:`, `ci:`, `style:`, `build:`, and subjects containing `Merge `. Scoped variants such as `docs(api):` are not excluded by those regexes; see [.goreleaser.yaml](../.goreleaser.yaml).

The [Release workflow](../.github/workflows/release.yml) binds `GORELEASER_CURRENT_TAG` to the triggering `github.ref_name`, so stable, prerelease, and desktop tags can share a commit without changing the release destination or stamped version. Before building/signing, [previous-core-tag.sh](../scripts/previous-core-tag.sh) validates the core tag and checks that it points at HEAD. It sets `GORELEASER_PREVIOUS_TAG` to the highest strictly lower qualifying ancestor tag so stable notes include the entire prerelease cycle:

| Releasing | Changelog base |
| --- | --- |
| Stable | Previous stable |
| Beta / RC | Previous beta, RC, or stable |
| Alpha | Previous recognized release |

Newer tags on the same commit are excluded, including when an older prerelease is rerun. Only strict core tags with stable or `alpha.N`/`beta.N`/`rc.N` versions participate; desktop and legacy tags are excluded. If no qualifying base exists, the workflow retains GoReleaser’s default first-release behavior. The temporary-repository tests in `node --test scripts/build-version.test.mjs` cover promotion, reruns, numeric prerelease ordering, unrelated branches, annotated tags, checkout validation, and local version overrides.

Keep this selection aligned with the core updater's maturity rules. The app renders the release body in Settings → About when an update is available. Desktop uses a separate generated download table and source/core references from [desktop-release.mjs](../scripts/desktop-release.mjs).

## Local rehearsal

Start with [development setup](DEVELOPMENT.md#first-checkout). For core packaging, also install GoReleaser v2; signing rehearsals additionally require minisign. Run from the repository root:

```bash
goreleaser check
goreleaser release --snapshot --clean --skip=sign
```

The snapshot builds into `dist/` without publishing. `--skip=sign` avoids needing the CI-only `MINISIGN_SECRET_KEY_FILE`. To exercise signing, use a temporary test key:

```bash
test_key_dir=$(mktemp -d)
minisign -G -W -p "$test_key_dir/test.pub" -s "$test_key_dir/test.key"
MINISIGN_SECRET_KEY_FILE="$test_key_dir/test.key" goreleaser release --snapshot --clean
minisign -Vm dist/checksums.txt -p "$test_key_dir/test.pub"
```

A snapshot is a build rehearsal, not a feed/apply test. Test publication and installation in an isolated fork with its own keys and matching compiled update source, using a disposable older release-versioned binary and temporary runtime state. Authenticate it and use the update UI, which supplies the apply header. Do not publish throwaway test tags into the official consumer feed.

For desktop, see [local packaging](../desktop/README.md#package). `make desktop-fetch-core` reproduces CI staging and needs `gh`; `make desktop-dev` / `make desktop-dist` build core from the working tree instead.
