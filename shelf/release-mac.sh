#!/bin/sh
# Build, notarize and stage one example's macOS release, one CPU at a time:
#
#   sh shelf/release-mac.sh <dir> [arm64] [x86_64]     # no arch = both
#
# Needs tinyjs >= 0.42 (build/notarize --arch), TINYJS_SIGN_IDENTITY (a
# Developer ID) and TINYJS_NOTARY_PROFILE. Per arch it stages:
#   _builds/<dir>-<ver>-macos-<arch>.dmg         the human download
#   _builds/<dir>/<dir>-<ver>-macos-<arch>.zip   the update payload
# The zip is made here from the STAPLED .app rather than by `tinyjs publish`,
# which rebuilds (and so re-signs) the bundle after notarization.
#
# Then: gh release upload <dir>-v<ver> (both files per arch),
# node shelf/merge-manifest-mac.js <dir>, node shelf/gen-catalog.js.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$1"
[ -n "$DIR" ] && [ -f "$ROOT/$DIR/tinyjs.json" ] || { echo "usage: release-mac.sh <dir> [arm64] [x86_64]"; exit 2; }
shift
ARCHS="${*:-arm64 x86_64}"
TINYJS="${TINYJS:-tinyjs}"
cd "$ROOT/$DIR"
field() { sed -n "s/^ *\"$1\": *\"\([^\"]*\)\".*/\1/p" tinyjs.json | head -1; }
VER="$(field version)"
NAME="$(field name)"
TITLE="$(field title)"; TITLE="${TITLE:-$NAME}"
mkdir -p "$ROOT/_builds/$DIR"
for ARCH in $ARCHS; do
  echo "==> $DIR $VER ($ARCH)"
  "$TINYJS" build --arch "$ARCH" --dmg
  "$TINYJS" notarize --arch "$ARCH" --dmg
  xcrun stapler validate -q "dist/$TITLE.app"
  cp "dist/$NAME-$VER-macos-$ARCH.dmg" "$ROOT/_builds/$DIR-$VER-macos-$ARCH.dmg"
  rm -f "$ROOT/_builds/$DIR/$DIR-$VER-macos-$ARCH.zip"
  ditto -c -k --keepParent "dist/$TITLE.app" "$ROOT/_builds/$DIR/$DIR-$VER-macos-$ARCH.zip"
  echo "    staged $DIR-$VER-macos-$ARCH.{dmg,zip}"
done
