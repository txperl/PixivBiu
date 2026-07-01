# Release

How to cut a PixivBiu release and how update channels work.

A release is a single self-contained binary (frontend embedded). You publish one by pushing a strict-semver `v*` git tag — everything else is automated.

There are **two independent release trains**: the **core** train (`v*`, this document's main subject — the CLI/server binary, Docker image, and in-app self-updater feed) and the **desktop** train (`desktop-v*`, the Electron app), which ships on its own cadence and bundles a *pinned* core. See [Desktop release train](#desktop-release-train) at the end. Frontend changes ride the **core** train — the SPA is `go:embed`-ed into the core binary and never shipped on its own.

## How a release happens

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which runs [GoReleaser](https://goreleaser.com) (`.goreleaser.yaml`):

```bash
git tag v3.0.0
git push origin v3.0.0
```

GoReleaser builds the frontend (`make build-web`), cross-compiles linux/macOS/windows × amd64/arm64 (`CGO_ENABLED=0`, SPA baked in), and publishes a GitHub Release with the archives, `checksums.txt` (SHA-256), and a grouped changelog. The version is injected at link time via `-ldflags -X main.version={{ .Version }}` (GoReleaser strips the leading `v`, so the binary reports `3.0.0`).

A following workflow step then **dual-publishes to Cloudflare R2** — the source the in-app updater actually reads (see [Distribution & signing](#distribution--signing) below). The GitHub Release stays as the human-readable notes page and a download mirror; the R2 feed is what `POST /system/update/check` and `…/apply` consume. This needs [one-time setup](#one-time-setup) (R2 bucket, signing key, secrets) — **until that's done the updater fails closed** (no update offered), which is the safe default.

## Distribution & signing

The in-app updater does **not** call the GitHub API. It fetches a static, signed feed from the Cloudflare R2 bucket (behind a CDN custom domain):

```
<feed>/manifest.json            # the feed: recent releases, each with notes + per-platform archives (name, url, size, sha256)
<feed>/manifest.json.minisig    # detached minisign (Ed25519) signature of manifest.json
<feed>/releases/<tag>/PixivBiu_<ver>_<os>_<arch>.{tar.gz,zip}
```

Only the archives and the signed manifest live on the CDN — the per-release `checksums.txt` is **not** uploaded there (the GitHub Release still carries it). Each archive's SHA-256 travels inside the signed manifest, so an unsigned `checksums.txt` on the CDN would add nothing but a misleadingly authoritative-looking artifact.

**Trust model.** The client verifies the manifest's minisign signature against a public key **compiled into the binary** before trusting any field; the manifest carries each archive's SHA-256 inline, so a verified manifest transitively authenticates every download (there is no separate `checksums.txt` fetch). The signing **secret key lives only in CI** — so even if the R2 write credentials leak, a tampered manifest or binary is rejected. The release workflow reinforces this by **verifying the existing feed's signature before extending it** (against the trusted `UPDATE_PUBLIC_KEYS`): a tampered `manifest.json` on R2 is discarded and rebuilt fresh, never re-signed with the CI key. This is strictly stronger than the old "HTTPS to GitHub + checksums" model. If the signature doesn't verify, the check is **refused** (`bad_request`/400), not silently trusted.

**Caching.** Archives live under an immutable, version-pinned path and are cached forever; `manifest.json` (+ `.minisig`) get a short TTL and are **explicitly cache-purged** on every release, so a new version reaches users within seconds.

**Yanking a bad release.** Because the archives are content-addressed by tag and the manifest just lists recent releases, pulling a release is: edit `manifest.json` to drop (or replace) that entry, re-sign, re-upload, purge. The older archives stay in place, so the feed can safely point back at a previous version.

## One-time setup

Do these once; afterwards a release is just `git push`. Until they're done, the trust anchor is unset (the source ships it empty and no repo variable fills it) and the updater **fails closed** — no trusted key → no update is ever offered, the safe default.

### 1 · Cloudflare R2

- **Create a bucket** (e.g. `pixivbiu-dl`) — its name is `R2_BUCKET`.
- **Bind a custom domain** (e.g. `dl.pixivbiu.example`) under bucket → Settings → Custom Domains — this is the public CDN base.
- **Create an R2 API token** (**Object Read & Write**) → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and the S3 endpoint `https://<account-id>.r2.cloudflarestorage.com` → `R2_ENDPOINT`.

Two URLs, don't mix them up: `R2_ENDPOINT` (`*.r2.cloudflarestorage.com`) is the authenticated **S3 API the workflow uploads to**; the custom domain (`dl.…`) is the public **CDN users download from** — it is the `UPDATE_FEED_BASE` variable below, which is also stamped into the binary as `updateFeedURL` (§3). The endpoint does not include the bucket name; the workflow appends it.

**Cache rule** (optional belt-and-suspenders, so a stale manifest can't mask a new release): zone → Caching → Cache Rules → Create rule. Match `(http.host eq "dl.…" and starts_with(http.request.uri.path, "/manifest.json"))`, action **Edge TTL → Override origin → 5 minutes**. The one `starts_with` covers both `/manifest.json` and `/manifest.json.minisig` in a single flat condition the visual builder accepts — a nested `… or …` is valid Wirefilter but the builder rejects it (use "Edit expression" text mode if you prefer the explicit form). The workflow already sets a short `Cache-Control` on both files (and tags the immutable `releases/<tag>/*` archives long-cache), so this rule only matters if you want the edge TTL pinned independently of the origin header.

**Cache purge** (optional — `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID`): lets the workflow drop the cached manifest right after upload, so a new release is visible instantly instead of after the ≤5-min TTL. Harmless to skip for a background updater — the step just prints "skipped". Not redundant with the cache rule: the rule bounds staleness to 5 min, the purge removes even that window. To enable: `CLOUDFLARE_ZONE_ID` = zone → Overview → **Zone ID**; `CLOUDFLARE_API_TOKEN` = My Profile → API Tokens → a custom token with `Zone → Cache Purge`, scoped to your zone (copy it once at creation).

### 2 · Signing key (minisign)

```bash
minisign -G -W -p minisign.pub -s minisign.key   # -W = unencrypted key, so CI signs non-interactively
```

The public key is the base64 line in `minisign.pub`; the private key (`minisign.key`) is a CI secret only — never upload it to R2 or commit it. One keypair covers all versions — **back it up**, or installed clients can't verify future updates (see [key rotation](#key-rotation) for why losing it is painful).

### 3 · Trust anchor (stamped at build time — no source edit)

The feed URL and the trusted public key are the **trust anchor** — together they decide what code the updater installs on every user's machine — so they're compiled into the binary and can't be overridden at runtime. But they are **not** hardcoded in source: the release build stamps them in via `-ldflags` (exactly like `main.version`), sourced from two repo variables (§4):

- `UPDATE_FEED_BASE` → `main.updateFeedURL` (the custom domain from §1, e.g. `https://dl.pixivbiu.example`).
- `UPDATE_PUBLIC_KEYS` → `main.updateTrustedKeysRaw` (the `minisign.pub` base64 line; comma-separate multiple keys to stage a [rotation](#key-rotation)).

`cmd/server/main.go` ships these empty, so a fresh checkout — or any build without the variables set — **fails closed** (no trusted key → no update ever offered, the safe default). Set the variables once and every release stamps the anchor automatically. This is why publishing your own builds (a [fork](#forking--self-publishing)) needs no code change, and why the old "`updateFeedURL` must equal `UPDATE_FEED_BASE`" hand-sync is gone: the binary and the workflow read the same value.

### 4 · GitHub secrets & variables

Settings → Secrets and variables → Actions:

| Kind                | Name                                          | Value                                                          |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| secret              | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`   | R2 API token — §1                                             |
| secret              | `R2_ENDPOINT`                                 | `https://<account-id>.r2.cloudflarestorage.com` — §1          |
| secret              | `R2_BUCKET`                                    | bucket name — §1                                              |
| secret              | `MINISIGN_SECRET_KEY`                          | the unencrypted `minisign.key` file contents — §2            |
| variable            | `UPDATE_FEED_BASE`                            | public CDN base — §1; stamped into the binary as `updateFeedURL` |
| variable            | `UPDATE_PUBLIC_KEYS`                          | trusted `minisign.pub` key(s), comma-separated — §2; public, stamped into the binary and used to verify the feed |
| secret _(optional)_ | `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID`  | manifest cache purge — §1                                     |

**Repository vs Environment secrets:** plain repository secrets work as-is. For tighter scoping, put them in an **Environment** named `release` restricted to tag `v*` (Settings → Environments) and add `environment: release` to the workflow's job — then the signing key is only reachable from a real release run, with an optional manual-approval gate.

### Forking / self-publishing

Publishing your own updates from a fork takes **no code change** — everything above is driven by repo variables and secrets:

- Do §1 (your own R2 bucket + custom domain) and §2 (your own `minisign` keypair).
- Set the variables and secrets in §4 for your repo: `UPDATE_FEED_BASE` (your domain), `UPDATE_PUBLIC_KEYS` (your `minisign.pub`), the R2 secrets, and `MINISIGN_SECRET_KEY`. The release build stamps your feed URL and key into the binary; the workflow signs against them. Multiple keys go in `UPDATE_PUBLIC_KEYS` comma-separated (incidental spaces are normalized away before stamping).
- GoReleaser infers the GitHub Release target from your fork's git remote (`.goreleaser.yaml` no longer pins `owner`/`name`), so the release lands in your repo automatically.
- **Docker images** (`docker.yml`) get the same anchor: they read the same `UPDATE_FEED_BASE` / `UPDATE_PUBLIC_KEYS` repo variables as build args, so container builds surface the "update available" banner too (applying an update is a no-op in an immutable image — you pull a new tag). No extra setup beyond the variables above.

The only source-level knob is `project_name: PixivBiu` in `.goreleaser.yaml` — it names the archives and **must** match the asset-name prefix in `internal/update/update.go`. Leave it as-is, or change **both** if you rebrand.

### Key rotation

A client can only verify with a key already compiled into it, so rotation is forward-only and needs **no source edit**:

1. Add the **new** public key to `UPDATE_PUBLIC_KEYS` alongside the old one (comma-separated). The next release bakes both into the binary as trusted, and the release workflow (which verifies the existing feed with the same variable) accepts a feed still signed by the old key.
2. Wait for that release to become widespread.
3. Switch CI's `MINISIGN_SECRET_KEY` to the new secret. Releases now sign with the new key, which fielded clients already trust.
4. Drop the old key from `UPDATE_PUBLIC_KEYS` only once no in-field build still needs it.

Because one variable is both the trusted set and the feed-verification key, there's nothing else to keep in sync.

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
goreleaser check                       # lint the config
goreleaser release --snapshot --clean  # full dry run, no tag; artifacts land in dist/
```

This exercises the build, archives, and changelog only — the **R2 upload, manifest signing, and cache purge run solely in CI** (they need the secrets above).

To rehearse the whole pipeline once it's wired up, push a throwaway pre-release tag (e.g. `v0.0.0-rc.test`) and confirm: R2 has `releases/<tag>/…` plus a fresh `manifest.json` (+ `.minisig`), the GitHub Release exists, and the purge step logged success or skipped. Then point a real build at the feed — build it with a lower version (`-ldflags -X main.version=…`) — and run `POST /system/update/check` → `…/apply`. Delete the test tag and its R2 objects afterwards.

## Desktop release train

The desktop Electron app (`desktop/`) ships on its **own** train — tag `desktop-v*` — decoupled from the core `v*` train above. This is deliberate: the desktop app **bundles a pinned core** (Docker-Desktop style), so a shell-only change never forces a core release and a core-only change never forces a desktop one — no "phantom" updates on either side. The core train (and everything documented above) is unchanged.

### How a desktop release happens

Pushing a `desktop-v*` tag triggers `.github/workflows/desktop.yml`. It does **not** rebuild the core or the SPA — `scripts/stage-core.sh` downloads the core release pinned in [`desktop/.core-version`](../desktop/.core-version) (macOS prefers the `darwin_all` universal archive from GoReleaser's `universal_binaries`, falling back to lipo-ing the two per-arch archives when a pinned older core predates it), stages the binary into `desktop/resources/`, packages with `electron-builder --publish never`, and uploads the installers + `latest*.yml` to the desktop R2 feed.

```bash
# (optional) ship a newer core to desktop users first:
#   edit desktop/.core-version -> v3.0.2, commit
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

The desktop version is the tag minus `desktop-v` (`desktop-v1.0.0` → `package.json` `1.0.0`), which `electron-updater` compares against the feed. If the pinned core release is missing, the download step fails loudly (it never ships a desktop package around an absent core).

### Feed & downloads (R2)

`electron-updater` reads a **desktop-only** feed via the `generic` provider — a separate R2 path from the core self-updater's signed manifest, and fully isolated from the core `v*` GitHub Releases so the updater never mistakes a core release for a desktop one:

```
<feed>/desktop/latest-mac.yml | latest.yml | latest-linux.yml   # electron-updater metadata (mutable, short TTL)
<feed>/desktop/PixivBiu-<ver>-*.{dmg,zip,exe,AppImage,deb} + .blockmap   # version-named installers (immutable)
<feed>/desktop/PixivBiu-latest-{macos.dmg,windows.exe,linux.AppImage}    # stable download aliases for the README (mutable)
```

The feed base is `<DESKTOP_FEED_BASE>/desktop` (default `https://dl.biu.tls.moe/desktop`, set in `desktop/electron-builder.yml`; CI overrides via `-c.publish.url` when `vars.DESKTOP_FEED_BASE` is set). Integrity rides electron-updater's native `latest*.yml` sha512 + the macOS code signature — there is **no** minisign here (that's the core train's model). The stable `PixivBiu-latest-*` aliases are what the README links for first-time installs (auto-update handles everything after).

### Secrets & variables (desktop)

Reuses the core train's `R2_*` secrets (the [one-time setup](#one-time-setup) table above) for the upload, plus:

| Kind                | Name                                                             | Value                                            |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| secret              | `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD`                          | macOS Developer ID cert (.p12, base64) + password |
| secret              | `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`     | notarization credentials                         |
| variable _(opt.)_   | `DESKTOP_FEED_BASE`                                              | desktop feed base; defaults to the `electron-builder.yml` value |

macOS is signed + notarized; Windows / Linux ship **unsigned** in v1 (electron-updater still works via `latest*.yml` sha512).

### Bump the bundled core / local repro

To ship a newer core to desktop users: bump `desktop/.core-version` and cut a `desktop-v*` tag. To test the exact CI-staged core locally, `make desktop-fetch-core` runs the same `scripts/stage-core.sh` (needs `gh`); `make desktop-dev` / `desktop-dist` instead build the core from the working tree. Full shell/architecture notes: [desktop/README.md](../desktop/README.md).
