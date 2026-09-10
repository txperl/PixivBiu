#!/usr/bin/env bash
# Print the newest lower ancestor tag accepted by the current core channel.
# An empty result preserves GoReleaser's first-release fallback.
set -euo pipefail
cur="${1:?usage: previous-core-tag.sh <core-tag>}"

rank() {
  local t="$1" number='(0|[1-9][0-9]*)'
  if [[ "$t" =~ ^v${number}\.${number}\.${number}$ ]]; then
    echo 3
  elif [[ "$t" =~ ^v${number}\.${number}\.${number}-(alpha|beta|rc)\.${number}$ ]]; then
    case "${BASH_REMATCH[4]}" in
      alpha) echo 0 ;;
      beta) echo 1 ;;
      rc) echo 2 ;;
    esac
  else
    echo -1
  fi
}

fl="$(rank "$cur")"
if [ "$fl" -lt 0 ]; then
  echo "unsupported core release tag: $cur" >&2
  exit 1
fi
# RC consumers share the beta channel.
[ "$fl" -ne 2 ] || fl=1
commit="$(git rev-parse --verify "refs/tags/${cur}^{commit}")"
if [ "$commit" != "$(git rev-parse HEAD)" ]; then
  echo "core release tag $cur does not point at HEAD" >&2
  exit 1
fi
# Capture first so git failures cannot disappear inside process substitution.
tags="$(git -c versionsort.suffix=-alpha \
             -c versionsort.suffix=-beta \
             -c versionsort.suffix=-rc \
             tag --list 'v*' --merged "$commit" --sort=-version:refname)"
seen_current=0
while IFS= read -r t; do
  if [ "$t" = "$cur" ]; then
    seen_current=1
    continue
  fi
  # Same-commit tags may be NEWER than this release (especially on reruns).
  [ "$seen_current" -eq 1 ] || continue
  if [ "$(rank "$t")" -ge "$fl" ]; then
    printf '%s\n' "$t"
    exit 0
  fi
done <<< "$tags"
