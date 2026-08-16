#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_IDENTIFIER="${WQT_SITE_ID:-}"
TARGET="$(bash "${ROOT_DIR}/scripts/resolve-target.sh" "$SITE_IDENTIFIER")"
OUTPUT="${1:-${ROOT_DIR}/artifacts/raw/lighthouse.json}"
LIGHTHOUSE_BIN="${ROOT_DIR}/node_modules/.bin/lighthouse"

if [[ ! -x "$LIGHTHOUSE_BIN" ]]; then
  echo "Lighthouse CLI not installed at ${LIGHTHOUSE_BIN}" >&2
  exit 1
fi

if [[ -z "${CHROME_PATH:-}" ]]; then
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROME_PATH="$(command -v "$candidate")"
      export CHROME_PATH
      break
    fi
  done
fi
if [[ -z "${CHROME_PATH:-}" || ! -x "$CHROME_PATH" ]]; then
  echo "No supported Chrome/Chromium executable found for Lighthouse" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
"$CHROME_PATH" --version
"$LIGHTHOUSE_BIN" "$TARGET" \
  --preset=desktop \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=json \
  --output-path="$OUTPUT" \
  --quiet \
  --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu"

test -s "$OUTPUT"
