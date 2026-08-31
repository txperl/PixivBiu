# Release

How to cut a PixivBiu release and how update channels work.

A release is a single self-contained binary (frontend embedded). You publish one by pushing a strict-semver `v*` git tag — everything else is automated.

There are **two independent release trains**: the **core** train (`v*`, this document's main subject — the CLI/server binary, Docker image, and in-app self-updater) and the **desktop** train (`desktop-v*`, the Electron app), which ships on its own cadence, bundles a *pinned* core, and publishes into a dedicated releases repo. See [Desktop release train](#desktop-release-train) at the end. Frontend changes ride the **core** train — the SPA is `go:embed`-ed into the core binary and never shipped on its own.

## How a release happens

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which runs [GoReleaser](https://goreleaser.com) (`.goreleaser.yaml`):

```bash
git tag v3.0.0
git push origin v3.0.0
```

GoReleaser builds the frontend (`make build-web`), cross-compiles linux/macOS/windows × amd64/arm64 (`CGO_ENABLED=0`, SPA baked in), and publishes a GitHub Release with the archives, `checksums.txt` (SHA-256), its detached minisign signature `checksums.txt.minisig`, and a grouped changelog. The version is injected at link time via `-ldflags -X main.version={{ .Version }}` (GoReleaser strips the leading `v`, so the binary reports `3.0.0`).

That GitHub Release **is** the update source: `POST /system/update/check` lists releases via the GitHub API and `…/apply` downloads the platform archive from the release's assets. Signing needs [one-time setup](#one-time-setup) (minisign key + secrets) — until that's done, pushing a tag fails the workflow up front rather than publishing an unsigned release.

## Distribution & signing

Everything ships as assets on the GitHub Release — there is no separate CDN or feed:

```
PixivBiu_<ver>_<os>_<arch>.{tar.gz,zip}   # per-platform archives (what Apply downloads)
checksums.txt                              # SHA-256 of every archive (GoReleaser)
checksums.txt.minisig                      # detached minisign (Ed25519) signature of checksums.txt
```

**Trust model.** Official builds carry the trusted minisign public key(s) **compiled into the binary** (stamped from `UPDATE_PUBLIC_KEYS`, §2). Before installing anything, the updater downloads the release's `checksums.txt` + `checksums.txt.minisig`, verifies the signature, and only then checks the archive's SHA-256 against the verified file — one signature transitively authenticates every download. The signing **secret key lives only in CI** (`MINISIGN_SECRET_KEY`), so a tampered release is rejected even if the GitHub account were compromised. A release without a valid signature is **refused** (`bad_request`/400) — such a release isn't even offered by the check.

Builds **without** stamped keys (a fresh checkout, `make build`, an unconfigured fork) degrade gracefully instead of failing closed: they verify downloads by HTTPS-to-GitHub + `checksums.txt` alone, exactly the pre-signing model — so a fork's self-updater works with zero key setup. A stamped-but-malformed key does **not** degrade; it fails closed (a typo must never silently turn an official build unsigned).

**Yanking a bad release.** Delete the GitHub Release (or mark it a pre-release to hide it from the stable channel). The updater lists recent releases live, so the change is effective on the next check; clients then converge on the newest remaining applicable release.

## One-time setup

Do these once; afterwards a release is just `git push`. The release workflow refuses to publish until the signing pieces exist, so there's no window where an official tag ships unsigned.

### 1 · Signing key (minisign)

```bash
minisign -G -W -p minisign.pub -s minisign.key   # -W = unencrypted key, so CI signs non-interactively
```

The public key is the base64 line in `minisign.pub`; the private key (`minisign.key`) is a CI secret only — never commit it. One keypair covers all versions — **back it up**, or installed clients can't verify future updates (see [key rotation](#key-rotation) for why losing it is painful).

### 2 · Trust anchor (stamped at build time — no source edit)

The trusted public key set is the **trust anchor** — it decides what code the updater installs on every user's machine — so it's compiled into the binary and can't be overridden at runtime. But it is **not** hardcoded in source: the release build stamps it in via `-ldflags` (exactly like `main.version`), sourced from one repo variable (§3):

- `UPDATE_PUBLIC_KEYS` → `main.updateTrustedKeysRaw` (the `minisign.pub` base64 line; comma-separate multiple keys to stage a [rotation](#key-rotation)).

`cmd/server/main.go` ships this empty. An **unstamped** build (fresh checkout, plain `make build`, an unconfigured fork) is not signature-enforcing — its updater verifies by HTTPS + `checksums.txt` alone, so it keeps working with zero setup. Any **stamped** value makes the build refuse unsigned releases, and a stamped-but-malformed key fails closed. Set the variable once and every release stamps the anchor automatically.

The update **source** is the `repoOwner` / `repoName` consts in `cmd/server/main.go` (default `txperl/PixivBiu`) — a fork that wants its own binaries to self-update from its own repo edits those two consts (the one source-level knob besides the rebrand note below).

### 3 · GitHub secrets & variables

Settings → Secrets and variables → Actions:

| Kind     | Name                  | Value                                                                                          |
| -------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| secret   | `MINISIGN_SECRET_KEY` | the unencrypted `minisign.key` file contents — §1                                              |
| variable | `UPDATE_PUBLIC_KEYS`  | trusted `minisign.pub` key(s), comma-separated — §1; public, stamped into the binary as the trust anchor |

The workflow validates both before GoReleaser publishes anything: key shape, plus a sign/verify probe proving the secret pairs with a trusted key — a mismatch fails the run before a release exists, and the real `checksums.txt.minisig` is re-verified after publishing.

**Repository vs Environment secrets:** plain repository secrets work as-is. For tighter scoping, put them in an **Environment** named `release` restricted to tag `v*` (Settings → Environments) and add `environment: release` to the workflow's job — then the signing key is only reachable from a real release run, with an optional manual-approval gate.

### Forking / self-publishing

A fork gets a working release pipeline almost for free:

- **No key setup at all:** just push a tag. GoReleaser infers the GitHub Release target from your fork's git remote (`.goreleaser.yaml` doesn't pin `owner`/`name`) — but the anchor validation will fail the workflow; either provision keys (next bullet) or drop the anchor/sign steps from your fork's `release.yml`. Fork builds without stamped keys still self-update fine (HTTPS + checksum mode) — **from the repo their binary points at** (`repoOwner`/`repoName` in `cmd/server/main.go`, default `txperl/PixivBiu`; edit to self-update from your fork).
- **Signature-enforcing fork:** do §1 (your own keypair), set `UPDATE_PUBLIC_KEYS` + `MINISIGN_SECRET_KEY` (§3), and point `repoOwner`/`repoName` at your fork. Multiple keys go in `UPDATE_PUBLIC_KEYS` comma-separated (incidental spaces are normalized away before stamping).
- **Docker images** (`docker.yml`) get the same anchor: they read the same `UPDATE_PUBLIC_KEYS` repo variable as a build arg, so container builds verify the same way (applying an update is a no-op in an immutable image — you pull a new tag).

`project_name: PixivBiu` in `.goreleaser.yaml` names the archives and **must** match the asset-name prefix in `internal/update/update.go`. Leave it as-is, or change **both** if you rebrand.

### Key rotation

A client can only verify with a key already compiled into it, so rotation is forward-only and needs **no source edit**:

1. Add the **new** public key to `UPDATE_PUBLIC_KEYS` alongside the old one (comma-separated). The next release bakes both into the binary as trusted.
2. Wait for that release to become widespread.
3. Switch CI's `MINISIGN_SECRET_KEY` to the new secret. Releases now sign with the new key, which fielded clients already trust.
4. Drop the old key from `UPDATE_PUBLIC_KEYS` only once no in-field build still needs it.

Because one variable is both the trusted set and what the workflow's pairing probe checks the signer against, there's nothing else to keep in sync.

## Channels

The **tag suffix** is the only thing that picks a channel. `.goreleaser.yaml` runs `prerelease: auto`, so any tag with a prerelease suffix is flagged as a GitHub pre-release automatically.

The in-app updater uses a **cumulative maturity model**: a user's `app.update.channel` sets a floor (`stable` < `beta` < `alpha`), and each riskier channel is a superset that also accepts everything more stable. So `rc` has no dedicated channel — it folds into `beta` (and `alpha`).

The channel **default tracks the build**: installing a pre-release is itself the opt-in, so a stable/dev build defaults to `stable`, a beta/rc build to `beta`, and an alpha build to `alpha` (`internal/update/checker.go::DefaultChannel`, seeded in `cmd/server/main.go`). A user who ships a beta therefore keeps receiving betas without touching settings, and can still override `app.update.channel` explicitly.

| Tag suffix | Example tag      | GitHub         | Reaches channels        |
| ---------- | ---------------- | -------------- | ----------------------- |
| (none)     | `v3.0.0`         | normal release | stable · beta · alpha   |
| RC         | `v3.1.0-rc.1`    | pre-release    | beta · alpha            |
| Beta       | `v3.1.0-beta.1`  | pre-release    | beta · alpha            |
| Alpha      | `v3.1.0-alpha.1` | pre-release    | alpha                   |

```bash
# stable
git tag v3.0.0          && git push origin v3.0.0
# pre-release
git tag v3.1.0-beta.1   && git push origin v3.1.0-beta.1
```

## Tag rules

- **Strict semver only.** Legacy `v2.6.4a` / `v2.6.4b`-style suffixes are rejected by GoReleaser and `x/mod/semver`.
- **Only `-alpha` / `-beta` / `-rc` are recognized pre-release suffixes.** The in-app updater ranks them by maturity (`internal/update/checker.go::releaseRank`) and treats any _other_ prerelease suffix (`-dev`, `-snapshot`, a git-describe `-N-gHASH`, …) as a **dev build**: it is never offered as an update and `Apply` refuses to install it. Don't invent suffixes.
- **Dot-separate the counter:** `-beta.1`, not `-beta1`.

## Who receives an update

`semver.Compare` orders a prerelease **below** its release (`-alpha < -beta < -rc < release`). `resolveLatest` keeps every release at or above the channel's maturity floor, then offers the single semver-newest one that is strictly newer than the running version. Three consequences worth knowing:

- A user on `v3.0.0-beta.1` defaults to the `beta` channel, so they keep getting `v3.0.0-beta.2` and are then pulled up to `v3.0.0` once it ships. Even a beta user who has switched to the `stable` channel still lands on `v3.0.0` (the beta is filtered out and the stable is higher) — they just skip the intervening betas.
- A user on `v3.0.0` on the `beta` channel is offered `v3.1.0-beta.1` (3.1.0 > 3.0.0) but **not** `v3.0.0-beta.2` (lower than the installed 3.0.0).
- Because the model is cumulative, an `alpha`/`beta` user always still receives stable releases when they're the newest tag — every channel converges onto stable. A newer stable outranks any pre-release of the same version, so no one is stranded on a pre-release.

The only user-facing knob is `app.update.channel` (`stable` / `beta` / `alpha`), whose default is build-derived (above) — see [CONFIGURATION.md](CONFIGURATION.md).

## Changelog

Release notes are auto-generated from the commit history — there is no hand-written changelog. Commit subjects are grouped by their [Conventional Commits](https://www.conventionalcommits.org) prefix:

| Group     | Commit prefix                    |
| --------- | -------------------------------- |
| Features  | `feat:`                          |
| Bug fixes | `fix:`                           |
| Refactors | `refactor:`                      |
| Others    | anything else not excluded below |

`docs:`, `test:`, `chore:`, `ci:`, `style:`, `build:`, and merge commits are dropped. A clean, prefixed commit history is all it takes to get readable release notes — nothing to edit at release time.

**The commit range is channel-aware.** GoReleaser defaults to "since the immediately preceding tag," which would make a stable cut right after a run of pre-releases nearly empty — all the work was already itemized in the `-alpha`/`-beta` notes. To avoid that, the release workflow computes `GORELEASER_PREVIOUS_TAG` so each release's changelog spans everything since the **last release its channel's audience would already have received**:

| Releasing       | Changelog base (previous tag)        |
| --------------- | ------------------------------------ |
| stable          | the last stable                      |
| `-beta` / `-rc` | the last beta / rc / stable          |
| `-alpha`        | the last release (plain incremental) |

So a stable aggregates its whole pre-release cycle, while each pre-release still shows just what changed for the users who track that channel. The selection step (`.github/workflows/release.yml`, "Compute previous tag for changelog") mirrors the maturity ranking in `internal/update/checker.go` (`releaseRank` + `channelFloor`, including the rc→beta fold) — **keep the two in sync** if those ranks ever change.

The full release body (this generated changelog) is also rendered inline in the app's **Settings → About** card when an update is available, so users see what's new without leaving for GitHub.

## Verify

Before tagging, lint and dry-run the build locally:

```bash
goreleaser check                                   # lint the config
goreleaser release --snapshot --clean --skip=sign  # full dry run, no tag; artifacts land in dist/
```

`--skip=sign` is needed locally because the `signs` block reads `MINISIGN_SECRET_KEY_FILE` (set by CI). To exercise signing too, point it at a throwaway key:

```bash
minisign -G -W -p /tmp/test.pub -s /tmp/test.key
MINISIGN_SECRET_KEY_FILE=/tmp/test.key goreleaser release --snapshot --clean
minisign -Vm dist/checksums.txt -p /tmp/test.pub   # should verify
```

To rehearse the whole pipeline once it's wired up, push a throwaway pre-release tag (e.g. `v0.0.0-rc.test`) and confirm the GitHub Release carries the archives + `checksums.txt` + `checksums.txt.minisig` and the "Verify checksums signature" step passed. Then run a real build with a lower version (`-ldflags -X main.version=…`, stamping `UPDATE_PUBLIC_KEYS` to exercise the signed path) and hit `POST /system/update/check` → `…/apply`. Delete the test tag + release afterwards.

Anyone can audit a published release by hand:

```bash
gh release download v3.1.0 -p 'checksums.txt*'
minisign -Vm checksums.txt -P <trusted public key>   # the UPDATE_PUBLIC_KEYS value
shasum -a 256 -c checksums.txt --ignore-missing      # after downloading an archive
```

## Desktop release train

The desktop Electron app (`desktop/`) ships on its **own** train — tag `desktop-v*` — decoupled from the core `v*` train above. This is deliberate: the desktop app **bundles a pinned core** (Docker-Desktop style), so a shell-only change never forces a core release and a core-only change never forces a desktop one — no "phantom" updates on either side. The core train (and everything documented above) is unchanged.

### Support matrix

| OS | Arch | Installer (user download) | Auto-update artifact | Signing |
| --- | --- | --- | --- | --- |
| macOS | arm64 **and** x64 (separate) | `.dmg` (per arch) | `.zip` + `.blockmap` (per arch) | Developer ID + notarized |
| Windows | x64 | NSIS `.exe` | `.exe` + `.blockmap` | Azure Trusted Signing when provisioned, else unsigned |
| Linux | x64 | AppImage, `.deb`, `.rpm` | AppImage + `.blockmap` | unsigned |

Only the AppImage / dmg-zip / nsis artifacts carry auto-update metadata (`latest*.yml`); `.deb` / `.rpm` are install-only (the system package manager owns updates). macOS ships **per-arch** rather than a universal binary: universal doubles the bundled ~85 MB Go core (and the Electron runtime), so a split roughly halves each user's download/disk. Both mac arches build in one run and share a single `latest-mac.yml`; electron-updater picks the slice matching `process.arch`.

### How a desktop release happens

Pushing a `desktop-v*` tag triggers `.github/workflows/desktop.yml`. It does **not** rebuild the core or the SPA — `scripts/stage-core.sh` downloads the core release pinned in [`desktop/.core-version`](../desktop/.core-version) and stages the per-arch binary into `desktop/resources/<arch>/` (macOS stages **both** `darwin_amd64` and `darwin_arm64` slices — one per arch, no lipo; Linux/Windows stage `*_amd64` into `x64/`). electron-builder embeds the slice matching each package via `extraResources: from: resources/${arch}/` and publishes into the desktop releases repo.

The flow is **draft-then-publish** across three jobs: a first job pre-creates a draft release `vX.Y.Z` in the releases repo (one idempotent create, so the three OS runners can't race electron-builder into duplicate drafts); the matrix builds and `electron-builder --publish always` uploads each platform's installers + `latest*.yml` into that draft (plus version-less `PixivBiu-latest-*` alias copies via `gh release upload`); a final job verifies all three platforms' update metadata (`latest-mac.yml` / `latest.yml` / `latest-linux.yml`) is present and only then flips the draft live — so electron-updater and the `/releases/latest` download links never see a half-built release. A prerelease desktop tag (e.g. `desktop-v1.2.0-beta.1`) is published with `--prerelease` instead of `--latest`, keeping the README's `/releases/latest/download/…` links on the last stable.

```bash
# (optional) ship a newer core to desktop users first:
#   edit desktop/.core-version -> v3.0.2, commit
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

The desktop version is the tag minus `desktop-v` (`desktop-v1.0.0` → `package.json` `1.0.0`), which `electron-updater` compares against the feed. If the pinned core release is missing, the download step fails loudly (it never ships a desktop package around an absent core).

### Channels (desktop)

Prerelease desktop tags work as channels, but the rules differ from the core train:

- **Only `-beta` and `-alpha` are allowed** (dot-separated counter: `desktop-v1.3.0-beta.1`). electron-updater's GitHub provider hardcodes exactly these two identifiers; any other suffix — **including `-rc`** — is treated as an unknown custom channel, and a user who installed such a build would only ever be offered releases with that same suffix, never the stable that follows. There is no rc→beta fold here (that's a core-train feature), so don't tag desktop rc's.
- **The channel is chosen by what the user installed — no config, no code.** electron-updater auto-enables prereleases when the running version has a prerelease component and derives the channel from it: stable installs resolve `/releases/latest` and never see prereleases; a beta install follows beta + stable (not alpha); an alpha install follows everything. Newest stable wins on every channel, so prerelease users converge back to stable — the same cumulative model as the core.
- **Metadata is always `latest*.yml`.** electron-builder's GitHub provider expresses channels via the tag suffix + prerelease flag, not via `beta.yml` file names (the updater tries `beta.yml` first and falls back to `latest.yml` by design), so the publish job's completeness check applies unchanged to prerelease tags.
- Prerelease releases skip the `PixivBiu-latest-*` alias uploads — `/releases/latest/download/…` only ever resolves to the newest stable, so aliases on a beta would be dead weight.

### Feed & downloads (the desktop releases repo)

`electron-updater` reads the **dedicated artifacts-only repo** [`txperl/PixivBiu-Desktop`](https://github.com/txperl/PixivBiu-Desktop) via its `github` provider, with plain `vX.Y.Z` tags. It **cannot** share this repo: the GitHub provider watches the newest release in its target repo, and the core's own `v*` releases (which carry no `latest*.yml`) would shadow the desktop ones and break every update check. Each desktop release carries:

```
latest-mac.yml | latest.yml | latest-linux.yml   # electron-updater metadata (one per platform)
PixivBiu-<ver>-<arch>.{dmg,zip,exe,AppImage,deb,rpm} + .blockmap   # version-named installers
PixivBiu-latest-{macos-arm64.dmg,macos-x64.dmg,windows.exe,linux.AppImage}   # version-less alias copies
```

The provider/owner/repo are set in `desktop/electron-builder.yml` (`publish:`) — that block is what the packaged `app-update.yml` (the updater's baked-in feed) is generated from, and where CI publishes; a fork points it at its own releases repo and updates `DESKTOP_REPO` in `desktop.yml` to match. Integrity rides electron-updater's native `latest*.yml` sha512 + the macOS code signature — there is **no** minisign here (that's the core train's model). The `PixivBiu-latest-*` aliases exist so the README can link fixed URLs via `…/releases/latest/download/<alias>` for first-time installs (auto-update handles everything after); they're not listed in `latest*.yml`, so the updater (and its blockmap differential downloads) ignores them.

### One-time setup (desktop)

1. Create the **public** releases repo (`PixivBiu-Desktop`) with at least one commit — a README saying "artifacts only; source lives in txperl/PixivBiu" is plenty. Public is required: electron-updater can't read private release assets without shipping a token inside the app.
2. Create a **fine-grained PAT** scoped to that repo only, permission **Contents: Read & Write**, and save it as the `DESKTOP_RELEASES_TOKEN` secret in **this** repo. Note the expiry — a lapsed token fails the draft job loudly at the next release.

### Secrets & variables (desktop)

| Kind                | Name                                                             | Value                                            |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| secret              | `DESKTOP_RELEASES_TOKEN`                                         | fine-grained PAT, Contents R/W on the releases repo only |
| secret              | `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD`                          | macOS Developer ID cert (.p12, base64) + password |
| secret              | `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`     | notarization credentials                         |
| secret _(opt.)_     | `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`    | Azure Trusted Signing service principal (Windows signing) |
| variable _(opt.)_   | `WIN_AZURE_ENDPOINT` / `WIN_AZURE_PUBLISHER_NAME` / `WIN_AZURE_ACCOUNT` / `WIN_AZURE_CERT_PROFILE` | Trusted Signing account config; **Windows signs only when `WIN_AZURE_ENDPOINT` is set** — unset ⇒ unsigned build |

macOS is signed + notarized. Windows signs via **Azure Trusted Signing** once the `WIN_AZURE_*` variables + `AZURE_*` secrets are provisioned (the build stays unsigned until then — the workflow injects `-c.win.azureSignOptions.*` only when `WIN_AZURE_ENDPOINT` is set). Linux ships unsigned. electron-updater works regardless via `latest*.yml` sha512.

### Bump the bundled core / local repro

To ship a newer core to desktop users: bump `desktop/.core-version` and cut a `desktop-v*` tag. To test the exact CI-staged core locally, `make desktop-fetch-core` runs the same `scripts/stage-core.sh` (needs `gh`); `make desktop-dev` / `desktop-dist` instead build the core from the working tree. Full shell/architecture notes: [desktop/README.md](../desktop/README.md).
