#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${WQT_TARGET:-https://lowcountrydigitalworks.com}"
EXPECTED_TARGET="https://lowcountrydigitalworks.com"
BINARY="${SITEONE_BIN:-${ROOT_DIR}/tools/bin/siteone-crawler}"
OUTPUT="${1:-${ROOT_DIR}/artifacts/raw/siteone.json}"

if [[ "$TARGET" != "$EXPECTED_TARGET" ]]; then
  echo "Baseline 0.1 is authorized only for ${EXPECTED_TARGET}; got ${TARGET}" >&2
  exit 2
fi
if [[ ! -x "$BINARY" ]]; then
  echo "SiteOne binary not found or not executable: ${BINARY}" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"

# Evidence-establishing run: intentionally NO --ci, --browser, --ai-*, or --upload.
# Scanner findings/scores are evidence only; only an actual command/runtime failure is fatal.
"$BINARY" \
  --url="$TARGET" \
  --output=json \
  --output-json-file="$OUTPUT" \
  --output-html-report='' \
  --output-text-file='' \
  --http-cache-dir='' \
  --workers=2 \
  --max-reqs-per-sec=5 \
  --hide-progress-bar \
  --no-color

test -s "$OUTPUT"
