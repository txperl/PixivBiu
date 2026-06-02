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

| Channel | Example tag      | GitHub         | Who gets the update                                |
| ------- | ---------------- | -------------- | -------------------------------------------------- |
| Stable  | `v3.0.0`         | normal release | everyone                                           |
| RC      | `v3.1.0-rc.1`    | pre-release    | only users with `app.update.include_prerelease` on |
| Beta    | `v3.1.0-beta.1`  | pre-release    | same                                               |
| Alpha   | `v3.1.0-alpha.1` | pre-release    | same                                               |

```bash
# stable
git tag v3.0.0          && git push origin v3.0.0
# pre-release
git tag v3.1.0-beta.1   && git push origin v3.1.0-beta.1
```

## Tag rules

- **Strict semver only.** Legacy `v2.6.4a` / `v2.6.4b`-style suffixes are rejected by GoReleaser and `x/mod/semver`.
- **Only `-alpha` / `-beta` / `-rc` are real channels.** The in-app updater (`internal/update/update.go::isDevVersion`) treats any _other_ prerelease suffix (`-dev`, `-snapshot`, a git-describe `-N-gHASH`, …) as a **dev build**: it is never offered as an update and `Apply` refuses to install it. Don't invent suffixes.
- **Dot-separate the counter:** `-beta.1`, not `-beta1`.

## Who receives an update

`semver.Compare` orders a prerelease **below** its release (`-alpha < -beta < -rc < release`), and the updater (`internal/update/checker.go::resolveLatest`) only offers a version strictly newer than the running one. Two consequences worth knowing:

- A user on `v3.0.0-beta.1` is pulled up to `v3.0.0` once the stable release ships (and reaches them even with prereleases disabled, since the beta is filtered out and the stable is higher).
- A user on `v3.0.0` with prereleases **on** is offered `v3.1.0-beta.1` (3.1.0 > 3.0.0) but **not** `v3.0.0-beta.2` (lower than the installed 3.0.0).

The only user-facing knob is `app.update.include_prerelease` (default off) — see [CONFIGURATION.md](CONFIGURATION.md).

## Changelog

The release notes are auto-generated from the commits since the previous tag — there is no hand-written changelog. Commit subjects are grouped by their [Conventional Commits](https://www.conventionalcommits.org) prefix:

| Group     | Commit prefix                    |
| --------- | -------------------------------- |
| Features  | `feat:`                          |
| Bug fixes | `fix:`                           |
| Refactors | `refactor:`                      |
| Others    | anything else not excluded below |

`docs:`, `test:`, `chore:`, `ci:`, `style:`, `build:`, and merge commits are dropped. A clean, prefixed commit history is therefore all it takes to get readable release notes — nothing to edit at release time.

## Validate before tagging

```bash
goreleaser check                       # lint the config
goreleaser release --snapshot --clean  # full dry run, no tag; artifacts land in dist/
```
