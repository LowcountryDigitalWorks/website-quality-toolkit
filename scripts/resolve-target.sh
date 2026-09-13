#!/usr/bin/env bash
set -euo pipefail

# Thin CLI wrapper: the target registry (config/targets.json) is the single
# source of truth. Actual parsing/validation lives in resolve-target.mjs so it
# is unit-testable directly and shares fail-closed logic with any future
# non-shell caller.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "${ROOT_DIR}/scripts/resolve-target.mjs" "${1:-}"
