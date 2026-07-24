#!/bin/bash
# Upload staged Linux tarballs to GitHub Releases — one release per app per
# version, tag <dir>-v<version> (version-skewed platforms get their own tags;
# same-version mac/win artifacts can join the same tag later).
#
# Run AFTER `tinyjs publish` per app and copying tarballs into _builds/<dir>/,
# and BEFORE merge-manifest-linux.js --release / gen-catalog-linux.js --release
# (they emit urls that point at these assets, so the assets must exist first).
#
#   bash shelf/upload-releases-linux.sh
#
# Uploads the fresh x86_64 tarball plus the same-version arm64 one when it is
# staged — both arches must live in the release or --release catalogs would
# emit a dead url. Idempotent: --clobber re-uploads over existing assets.
set -e
cd "$(dirname "$0")/.."
REPO=tarwin/tinyjsapp-examples

for d in */; do
  d="${d%/}"
  [ -f "$d/tinyjs.json" ] || continue
  tb=$(ls "$d"/dist/publish/*-linux-x86_64.tar.gz 2>/dev/null | head -1 || true)
  [ -n "$tb" ] || { echo "skip: $d (no fresh x86_64 tarball)"; continue; }
  file=$(basename "$tb")
  ver=$(echo "$file" | sed -E 's/^.*-([0-9][0-9a-zA-Z.]*)-linux-x86_64\.tar\.gz$/\1/')
  tag="$d-v$ver"

  assets=("_builds/$d/$file")
  arm="_builds/$d/${file/x86_64/arm64}"
  if [ -f "$arm" ]; then assets+=("$arm"); else echo "WARN: $d has no arm64 $ver tarball staged"; fi

  if ! gh release view "$tag" -R "$REPO" >/dev/null 2>&1; then
    gh release create "$tag" -R "$REPO" --title "$d v$ver" \
      --notes "Linux builds for $d $ver (x86_64 + arm64): payload for the shelf catalog and the in-app updater." >/dev/null
  fi
  gh release upload "$tag" "${assets[@]}" --clobber -R "$REPO" >/dev/null
  echo "$tag <- ${assets[*]}"
done
