#!/bin/bash
# Package example apps for Linux — runs INSIDE an ubuntu:22.04 container.
# This is the only sanctioned way to build Linux tarballs: the linker bakes
# the build userspace's glibc floor into every binary, and a tarball packaged
# from a newer host refuses to load on Ubuntu 22.04 / Debian 12 (how amp
# 0.8.0–0.10.0 shipped broken; see tinyjsapp TODO-linux.md).
#
# Host usage (run once per arch; Rosetta covers x86_64 on the ARM VM):
#   S=/path/to/scratch && mkdir -p $S/fleet-arm64 $S/fleet-x86_64
#   docker run --rm --platform linux/arm64 \
#     -v $PWD/shelf/pkg-linux-container.sh:/pkg.sh:ro \
#     -v $S/fleet-arm64:/work -v $PWD:/examples:ro \
#     -e TINYJS_TAG=v0.33.0 ubuntu:22.04 bash /pkg.sh
#   docker run --rm --platform linux/amd64 ... $S/fleet-x86_64:/work ...
#
# Env: TINYJS_TAG (required) — tinyjs release to build against.
#      APPS (optional) — space-separated app dirs; default: all except amp
#      unless amp is named explicitly.
# Output: /work/out/<app>/{<name>-<ver>-linux-<arch>.tar.gz, manifest-<arch>.json}
# Then continue with the runbook: stage _builds + dist/publish, upload,
# merge-manifest, gen-catalog, README links.
set -euo pipefail
: "${TINYJS_TAG:?set TINYJS_TAG to the tinyjs release to build against (e.g. v0.33.0)}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl git xz-utils build-essential pkg-config binutils \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  libx11-dev libxtst-dev libpipewire-0.3-dev >/dev/null

ARCH=$(uname -m); case "$ARCH" in aarch64) ARCH=arm64;; esac

# Node 20 from nodejs.org (jammy's apt node is 12 — too old for the vite/
# rolldown apps). A BUILD tool only: nothing it produces is a native binary,
# so it can't affect the glibc floor of what ships.
NODE_ARCH=$ARCH; [ "$ARCH" = x86_64 ] && NODE_ARCH=x64
curl -fsSL "https://nodejs.org/dist/v20.19.0/node-v20.19.0-linux-$NODE_ARCH.tar.xz" \
  | tar -xJ -C /usr/local --strip-components=1
node --version >/dev/null

cd /work && rm -rf tinyjsapp apps out && mkdir -p apps out
git clone -q --depth 1 --branch "$TINYJS_TAG" https://github.com/tarwin/tinyjsapp.git
(cd tinyjsapp && TINYJS_TJS_RELEASE="$TINYJS_TAG" ./setup.sh >/dev/null)

floor_ok() { # <binary> — glibc floor must stay ≤ 2.35 (Ubuntu 22.04)
  local top; top=$(objdump -T "$1" | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1)
  case "$top" in GLIBC_2.3[0-5]|GLIBC_2.[12]*) return 0;; *) echo "FLOOR REGRESSION: $1 needs $top"; return 1;; esac
}
floor_ok tinyjsapp/bin/tjs && floor_ok tinyjsapp/native/launcher-linux
echo "toolchain floors OK ($ARCH)"

if [ -n "${APPS:-}" ]; then LIST=$APPS; else
  LIST=$(cd /examples && for t in */tinyjs.json; do d=${t%/tinyjs.json}; [ "$d" = amp ] || echo "$d"; done)
fi

fail=0
for app in $LIST; do
  cp -R "/examples/$app" "apps/$app"
  cd "apps/$app" && rm -rf dist .build
  # node_modules copied from the host carry the HOST's native bindings
  # (rolldown etc.) — reinstall from the lockfile for THIS platform.
  if [ -f package.json ]; then
    rm -rf node_modules
    npm ci --no-audit --no-fund >/dev/null 2>&1 \
      || { rm -f package-lock.json; npm i --no-audit --no-fund >/dev/null 2>&1; }
  fi
  if ! /work/tinyjsapp/tinyjs publish >/dev/null 2>&1; then
    echo "PUBLISH FAILED: $app"; fail=1; cd /work; continue
  fi
  tb=$(ls dist/publish/*-linux-$ARCH.tar.gz)
  name=$(basename "$tb" | sed 's/-[0-9].*//')
  # floor-check what actually landed IN the tarball, not just the toolchain
  rm -rf /tmp/tc && mkdir /tmp/tc && tar -xzf "$tb" -C /tmp/tc
  floor_ok "/tmp/tc/$name/$name" || fail=1
  floor_ok "/tmp/tc/$name/launcher" || fail=1
  mkdir -p "/work/out/$app"
  cp "$tb" "/work/out/$app/"
  cp dist/publish/manifest.json "/work/out/$app/manifest-$ARCH.json"
  echo "packaged: $app ($(basename "$tb"))"
  cd /work
done
[ "$fail" = 0 ] && echo "PKG_${ARCH}_OK" || { echo "PKG_${ARCH}_FAILED"; exit 1; }
