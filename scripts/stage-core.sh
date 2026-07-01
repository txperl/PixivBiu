#!/usr/bin/env bash
# Stage the pinned core release binary into a destination dir for the desktop
# Electron build. Shared by BOTH .github/workflows/desktop.yml and the Makefile
# `desktop-fetch-core` target so the CI and local paths are byte-for-byte the
# same logic.
#
#   stage-core.sh <core-version-tag> <dest-dir>
#
# Detects the host platform via `uname` and downloads the matching archive from
# the core GitHub release with the gh CLI (needs gh auth / GH_TOKEN). On macOS it
# prefers the universal `darwin_all` archive but falls back to lipo-ing the two
# per-arch archives, so a pinned core release cut *before* GoReleaser's
# universal_binaries config (which has no darwin_all asset) still works.
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
    d="$(mktemp -d "$tmproot/XXXXXX")"
    if gh release download "$ver" --repo "$repo" \
         --pattern '*_darwin_all.tar.gz' --dir "$d" 2>/dev/null; then
      tar -xf "$(find "$d" -maxdepth 1 -type f | head -n1)" -C "$d"
      cp "$d/pixivbiu" "$dest/pixivbiu"
    else
      echo "note: $ver has no darwin_all archive — assembling universal via lipo" >&2
      amd="$(extract '*_darwin_amd64.tar.gz' pixivbiu)"
      arm="$(extract '*_darwin_arm64.tar.gz' pixivbiu)"
      lipo -create -output "$dest/pixivbiu" "$amd" "$arm"
    fi
    chmod +x "$dest/pixivbiu"
    ;;
  Linux)
    cp "$(extract '*_linux_amd64.tar.gz' pixivbiu)" "$dest/pixivbiu"
    chmod +x "$dest/pixivbiu"
    ;;
  *) # Windows (git bash reports MINGW*/MSYS*)
    cp "$(extract '*_windows_amd64.zip' pixivbiu.exe)" "$dest/pixivbiu.exe"
    ;;
esac

echo "staged core $ver into $dest" >&2
