#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_IDENTIFIER="${WQT_SITE_ID:-}"
SITEONE_INPUT="${1:-${ROOT_DIR}/artifacts/raw/siteone.json}"
OUTPUT="${2:-${ROOT_DIR}/artifacts/external-links/external-links.json}"
SUMMARY="${3:-${ROOT_DIR}/artifacts/external-links/summary.md}"

TARGET="$(bash "${ROOT_DIR}/scripts/resolve-target.sh" "$SITE_IDENTIFIER")"
WQT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
python3 "${ROOT_DIR}/scripts/external_links.py" \
  --site-id "$SITE_IDENTIFIER" \
  --target "$TARGET" \
  --wqt-commit "$WQT_COMMIT" \
  --siteone "$SITEONE_INPUT" \
  --output "$OUTPUT" \
  --summary-output "$SUMMARY"