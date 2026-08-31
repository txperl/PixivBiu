#!/usr/bin/env bash
# Stage the pinned core release binary into a destination dir for the desktop
# Electron build. Shared by BOTH .github/workflows/desktop.yml and the Makefile
# `desktop-fetch-core` target so the CI and local paths are byte-for-byte the
# same logic.
#
#   stage-core.sh <core-version-tag> <dest-dir>
#
# Detects the host platform via `uname` and downloads the matching archive(s)
# from the core GitHub release with the gh CLI (needs gh auth / GH_TOKEN).
# Binaries are staged per-arch into <dest-dir>/<arch>/ (x64 / arm64), matching
# electron-builder.yml's `extraResources: from: resources/${arch}/`, so each
# per-arch desktop package embeds only its own core slice. On macOS this stages
# BOTH slices (x64 + arm64) from the per-arch release archives — no lipo.
set -euo pipefail

ver="${1:?usage: stage-core.sh <core-version-tag> <dest-dir>}"
dest="${2:?usage: stage-core.sh <core-version-tag> <dest-dir>}"
repo="${CORE_REPO:-txperl/PixivBiu}"

mkdir -p "$dest"
tmproot="$(mktemp -d)"
trap 'rm -rf "$tmproot"' EXIT

# extract <asset-glob> <binary-name> -> echoes the path to the extracted binary.
# Tool chatter goes to stderr so command substitution captures only the path.
extract() {
  local d archive
  d="$(mktemp -d "$tmproot/XXXXXX")"
  gh release download "$ver" --repo "$repo" --pattern "$1" --dir "$d" >&2
  archive="$(find "$d" -maxdepth 1 -type f | head -n1)"
  case "$archive" in
    *.zip)
      # Git Bash on the Windows runner ships GNU tar, which can't read zip — use
      # a real zip tool (7-Zip is preinstalled on windows-latest; unzip covers
      # the rest).
      if command -v unzip >/dev/null 2>&1; then
        unzip -oq "$archive" -d "$d" >&2
      else
        7z x -y -o"$d" "$archive" >&2
      fi
      ;;
    *)
      # tar.gz — GNU tar and bsdtar both auto-detect the gzip.
      tar -xf "$archive" -C "$d" >&2
      ;;
  esac
  printf '%s\n' "$d/$2"
}

case "$(uname -s)" in
  Darwin)
    # Stage both slices so electron-builder can package arm64 and x64 from one run.
    mkdir -p "$dest/x64" "$dest/arm64"
    cp "$(extract '*_darwin_amd64.tar.gz' pixivbiu)" "$dest/x64/pixivbiu"
    cp "$(extract '*_darwin_arm64.tar.gz' pixivbiu)" "$dest/arm64/pixivbiu"
    chmod +x "$dest/x64/pixivbiu" "$dest/arm64/pixivbiu"
    ;;
  Linux)
    mkdir -p "$dest/x64"
    cp "$(extract '*_linux_amd64.tar.gz' pixivbiu)" "$dest/x64/pixivbiu"
    chmod +x "$dest/x64/pixivbiu"
    ;;
  *) # Windows (git bash reports MINGW*/MSYS*)
    mkdir -p "$dest/x64"
    cp "$(extract '*_windows_amd64.zip' pixivbiu.exe)" "$dest/x64/pixivbiu.exe"
    ;;
esac

echo "staged core $ver into $dest" >&2
