#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_IDENTIFIER="${WQT_SITE_ID:-}"
TARGET="$(bash "${ROOT_DIR}/scripts/resolve-target.sh" "$SITE_IDENTIFIER")"
OUTPUT="${1:-${ROOT_DIR}/artifacts/raw/lighthouse.json}"

# Public authority remains fixed to config/targets.json through resolve-target.sh.
# Scanner execution itself is shared with the trusted private-runtime path.
source "${ROOT_DIR}/scripts/scanner-core.sh"
wqt_run_lighthouse "$TARGET" "$OUTPUT"
