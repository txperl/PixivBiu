# Release

How to cut a PixivBiu release and how update channels work.

A release is a single self-contained binary (frontend embedded). You publish one by pushing a strict-semver `v*` git tag — everything else is automated.

## How a release happens

Pushing a `v*` tag triggers `.github/workflows/release.yml`, which runs [GoReleaser](https://goreleaser.com) (`.goreleaser.yaml`):

```bash
git tag v3.0.0
git push origin v3.0.0
```

GoReleaser builds the frontend (`make build-web`), cross-compiles linux/macOS/windows × amd64/arm64 (`CGO_ENABLED=0`, SPA baked in), and publishes a GitHub Release with the archives, `checksums.txt` (SHA-256), and a grouped changelog. The version is injected at link time via `-ldflags -X main.version={{ .Version }}` (GoReleaser strips the leading `v`, so the binary reports `3.0.0`).

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

## Validate before tagging

```bash
goreleaser check                       # lint the config
goreleaser release --snapshot --clean  # full dry run, no tag; artifacts land in dist/
```
