# Release

Use this checklist to configure publishing and cut releases. Commands run from the repository root in a POSIX shell unless stated otherwise. Replace example versions with unused tags on the tested commit; pushing a tag starts publication.

| What are you releasing? | Source tag | Publishes to | Procedure |
| --- | --- | --- | --- |
| Core, web UI, or Docker | `v3.0.0` | [Core releases](https://github.com/txperl/PixivBiu/releases) + GHCR | [Release core](#release-core) |
| Electron app or a newer bundled core | `desktop-v1.0.0` | [Desktop releases](https://github.com/txperl/PixivBiu-Desktop/releases), as `v1.0.0` | [Release desktop](#desktop-release-train) |

**First release?** Complete [one-time setup](#one-time-setup). **Something failed?** Go to [recovery](#failed-release-recovery). Artifact names, channel behavior, signing details, key rotation, and local rehearsals live in the [release reference](RELEASE_REFERENCE.md).

The web UI ships inside the core. Desktop bundles the already-published core pinned in [`desktop/.core-version`](../desktop/.core-version); it does not rebuild the core or web UI. To deliver a web UI change to desktop users, release core first, then update the pin and release desktop.

## One-time setup

You need permission to configure Actions secrets/variables and push release tags in the source repository. Local signing-key creation needs `minisign`; CI installs its own build tools. For a fork, first align the [publishing targets](RELEASE_REFERENCE.md#forking-and-rebranding).

### GitHub settings

1. In the **source repository**, configure the `Public-Release` environment under **Settings → Environments**. Allow the tags you will publish (`v*` and/or `desktop-v*`) and satisfy any protection rules.
2. Put the secrets below in that environment or under **Settings → Secrets and variables → Actions** at repository scope. They belong in the source repository, including the token used to publish desktop assets elsewhere.
3. Put `UPDATE_PUBLIC_KEYS` at **repository scope**: Docker does not use `Public-Release`. Avoid a different environment override; core and Docker must stamp the same trusted keys.

### Core signing

Create one keypair in a private directory outside the checkout. This example creates a new directory and stops if it already exists; reuse and back up an existing release key instead of regenerating it for each release.

```bash
key_dir="$HOME/.pixivbiu-signing"
(umask 077 && mkdir "$key_dir" && minisign -G -W -p "$key_dir/minisign.pub" -s "$key_dir/minisign.key")
```

`-W` creates an unencrypted key for non-interactive CI signing. Keep the private file and its backup private; never commit them.

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `MINISIGN_SECRET_KEY` | Entire contents of `minisign.key` |
| Repository variable | `UPDATE_PUBLIC_KEYS` | Base64 public-key line from `minisign.pub`, without its comment line |

The Release workflow validates key format and signs/verifies a probe before publishing. Multiple trusted public keys are only needed for [key rotation](RELEASE_REFERENCE.md#key-rotation). Docker publishes with the built-in `GITHUB_TOKEN`; no separate registry password is configured by the current workflow.

### Desktop publishing and signing

1. Create the **public**, dedicated desktop releases repository with at least one commit. The current target is `txperl/PixivBiu-Desktop`.
2. Create a fine-grained PAT scoped to that repository, with **Contents: Read & Write**. Save it as `DESKTOP_RELEASES_TOKEN` in the source repository and track its expiry.
3. Configure the macOS signing and notarization credentials below. Windows signing is optional; configure the entire Windows group before enabling it.

#### Secrets & variables (desktop)

| Required for | Kind | Name | Value |
| --- | --- | --- | --- |
| All desktop releases | Secret | `DESKTOP_RELEASES_TOKEN` | PAT from step 2 |
| macOS | Secret | `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` | Developer ID Application certificate exported as `.p12` (base64) / its password |
| macOS | Secret | `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | Apple account / app-specific password / developer team ID for notarization |
| Windows signing (optional) | Secret | `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | Azure Trusted Signing service-principal credentials |
| Windows signing (optional) | Variable | `WIN_AZURE_ENDPOINT` / `WIN_AZURE_PUBLISHER_NAME` / `WIN_AZURE_ACCOUNT` / `WIN_AZURE_CERT_PROFILE` | Service endpoint / certificate publisher name / signing account / certificate profile |

Windows stays unsigned when `WIN_AZURE_ENDPOINT` is unset; setting it enables signing and requires the remaining Windows values. Linux is unsigned. See the [desktop signing guide](../desktop/README.md#signing--notarization-macos) for local packaging checks.

## Release core

1. **Prepare:** commit the intended changes and confirm [development verification](DEVELOPMENT.md#verification) and CI pass for that commit. Check the working tree with `git status --short`. For packaging changes, also run a [local rehearsal](RELEASE_REFERENCE.md#local-rehearsal).
2. **Choose a tag:** stable `v3.0.0`, beta `v3.1.0-beta.1`, alpha `v3.1.0-alpha.1`, or RC `v3.1.0-rc.1`. Use strict semver with dot-separated counters; do not use `-beta1`, `-dev`, or legacy `v2.6.4a` suffixes. See [channel rules](RELEASE_REFERENCE.md#channels) when choosing an audience.
3. **Publish from the tested commit:**

```bash
git tag v3.0.0
git push origin v3.0.0
```

4. **Watch Actions:** both **Release** and **Docker** must succeed. They run independently; a green Release workflow does not prove the image was published.
5. **Confirm the result:** the core release has six platform archives (Linux/macOS/Windows × amd64/arm64), `checksums.txt`, and `checksums.txt.minisig`; the Release job's signature check passed. Confirm the Docker job's emitted image tags include both `linux/amd64` and `linux/arm64`. Inspect generated release notes and, when validating updates, check availability from an older accepted version on the intended channel.

Multiple tags may point at the same commit (for example alpha and stable): the workflow explicitly passes the triggering tag to GoReleaser. Changelog selection only considers lower versions accepted by the release channel.

GoReleaser builds the embedded web UI and generates the release notes automatically. A successful update check confirms required assets exist; installation performs signature/hash verification. For an independent download audit, use [verify a published archive](RELEASE_REFERENCE.md#verify-a-published-archive). Container users update by [replacing the image](DOCKER.md#updating).

## Desktop release train

1. **Prepare the core:** the shell requires desktop lifecycle protocol v1 (`pixivbiu-desktop/1`). Release the updated core first, then update the pin; older binaries are rejected by the package audit. Confirm the release in [`desktop/.core-version`](../desktop/.core-version) exists and has all required platform archives. To bundle a newer core, edit that file to its published `v*` tag and commit it before tagging desktop.
2. **Verify:** confirm CI and relevant [desktop smoke checks](../desktop/README.md#develop) pass. `make desktop-fetch-core` reproduces pinned-core staging locally (requires authenticated `gh`); `make desktop-dev` and `make desktop-dist` instead build core from the working tree. CI staging downloads/extracts assets but does not verify minisign/checksums itself.
3. **Choose a tag:** stable `desktop-v1.0.0`, beta `desktop-v1.1.0-beta.1`, or alpha `desktop-v1.1.0-alpha.1`. **Desktop does not support RC tags.** CI sets the package version from the tag; no manual `package.json` version bump is required.
4. **Publish from the tested commit:**

```bash
git tag desktop-v1.0.0
git push origin desktop-v1.0.0
```

5. **Watch Actions → Desktop:** **Create draft release → all three platform builds → Publish release** must succeed. Each platform's packaging hooks validate contents and save size reports in the job summary and `desktop-size-<OS>` Actions artifact. Review installer and expanded-byte changes against comparable builds. Audit or report-upload failure keeps the release in draft. The final job checks installers and update metadata before making the draft public; leave publication to that job.
6. **Confirm the result:** the desktop releases repository has `v1.0.0` with the correct source tag and pinned core in its release notes, working installer links, and `latest-mac.yml`, `latest.yml`, and `latest-linux.yml`. Stable releases become latest; prereleases leave the previous stable latest. Only versioned assets are published. Use the [artifact reference](RELEASE_REFERENCE.md#desktop-artifacts) if inspecting uploads manually.

## Failed release recovery

| Failure | What to do |
| --- | --- |
| Wrong release tag / duplicate asset names | Compare the triggering tag with GoReleaser’s `current` tag. The workflow must explicitly set `GORELEASER_CURRENT_TAG`; do not delete another version’s assets to make an incorrect upload succeed. Reruns use the original commit’s workflow, so a workflow fix on a newer commit needs a new release tag. |
| Core signing preflight | Correct missing/mismatched `MINISIGN_SECRET_KEY` and `UPDATE_PUBLIC_KEYS` in the scopes above; rerun once they match. |
| Core fails after uploading | Inspect the public release and signature step; publication is not transactional. Withdraw incomplete/bad releases before more users receive them. Use a new version for changed source or already-consumed artifacts. |
| Docker only | Fix and rerun the Docker job independently; verify image tags and both architectures afterwards. |
| Desktop token, certificate, platform build, or final verification | Keep the release in draft. Fix credentials/infrastructure and rerun failed jobs for the same source tag. The workflow reuses drafts and refuses already-published versions. Source changes require a new tag. |
| A published version is bad | Withdraw it from the release feed or return it to draft, then publish a higher fixed version. For installed users needing immediate recovery, provide manual replacement instructions with a compatible state backup. |

Never reuse a published version for different bytes. Withdrawing a release prevents future selection; it does not revoke started downloads or automatically downgrade installed clients. The core uses the tag's semver suffix for maturity, so checking GitHub's “pre-release” box on a stable tag does not hide it from stable-channel users.

The source of truth is [Release](../.github/workflows/release.yml), [Docker](../.github/workflows/docker.yml), [Desktop](../.github/workflows/desktop.yml), [GoReleaser config](../.goreleaser.yaml), and [desktop packaging config](../desktop/electron-builder.yml). Update this checklist and the [reference](RELEASE_REFERENCE.md) together when those contracts change.
