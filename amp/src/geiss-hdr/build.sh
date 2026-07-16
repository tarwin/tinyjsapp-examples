#!/bin/sh
# Rebuild amp's Geiss HDR bundle (src/frontend/geiss-hdr.bundle.js) from the
# vendored sources in this directory. Run from this directory:
#
#   sh build.sh
#
# Two steps because the engine needs a worker whose source must travel inside
# the single-file bundle (see amp_worker_shim.js):
#   1. bundle the worker (background_worker.js + motion.js etc) to plain text
#   2. bundle main.js, inlining the worker text, as one classic script
set -e
cd "$(dirname "$0")"

npx esbuild background_worker.js --bundle --format=iife \
  --outfile=worker.bundle.txt --log-level=warning

npx esbuild main.js --bundle --format=iife --loader:.txt=text --minify \
  --banner:js="$(cat banner.txt)" \
  --outfile=../frontend/geiss-hdr.bundle.js --log-level=warning

ls -la ../frontend/geiss-hdr.bundle.js
