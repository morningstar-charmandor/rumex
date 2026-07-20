#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="$ROOT/native/bin"
mkdir -p "$OUT"
CLANG_MODULE_CACHE_PATH="$OUT/module-cache" xcrun clang \
  -O2 -fobjc-arc \
  -framework Cocoa \
  -framework QuartzCore \
  -target arm64-apple-macos14.0 \
  "$ROOT/native/notch-helper/main.m" \
  -o "$OUT/RumexNotchHelper"
