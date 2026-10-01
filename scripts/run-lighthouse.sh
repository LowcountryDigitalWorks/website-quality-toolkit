#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/scanner-core.sh"
SITE_IDENTIFIER="${WQT_SITE_ID:-}"
TARGET="$(bash "${ROOT_DIR}/scripts/resolve-target.sh" "$SITE_IDENTIFIER")"
OUTPUT="${1:-${ROOT_DIR}/artifacts/raw/lighthouse.json}"

run_lighthouse_for_origin "$TARGET" "$OUTPUT"
