#!/usr/bin/env bash
# Installs the test dependency (Puppeteer) into ~/.cache/copycat-debug/test-deps, outside the
# extension folder (plan 35), from this folder's package.json / package-lock.json.
set -eu
cd "$(dirname "$0")"
DEPS=~/.cache/copycat-debug/test-deps
mkdir -p "$DEPS"
cp package.json package-lock.json "$DEPS/"
npm ci --ignore-scripts --prefix "$DEPS" --no-audit --no-fund
echo "Puppeteer installed in $DEPS"
