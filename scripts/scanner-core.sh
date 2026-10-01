#!/usr/bin/env bash
set -euo pipefail

# Library-only scanner implementation. Authority resolution must happen before
# either function is called. This file is intentionally not an executable
# free-form target surface.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "scanner-core.sh is library-only; resolve an authorized target before sourcing it." >&2
  exit 2
fi

WQT_SCANNER_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

wqt_run_siteone() {
  if [[ "$#" -ne 2 ]]; then
    echo "wqt_run_siteone requires: <validated-origin> <output-path>" >&2
    return 2
  fi

  local target="$1"
  local output="$2"
  local binary="${SITEONE_BIN:-${WQT_SCANNER_ROOT_DIR}/tools/bin/siteone-crawler}"

  if [[ -z "$target" || -z "$output" ]]; then
    echo "wqt_run_siteone requires non-empty validated origin and output path" >&2
    return 2
  fi
  if [[ ! -x "$binary" ]]; then
    echo "SiteOne binary not found or not executable: ${binary}" >&2
    return 1
  fi

  mkdir -p "$(dirname "$output")"

  # Evidence-establishing run: intentionally NO --ci, --browser, --ai-*, or --upload.
  # Scanner findings/scores are evidence only; only an actual command/runtime failure is fatal.
  "$binary" \
    --url="$target" \
    --output=json \
    --output-json-file="$output" \
    --output-html-report='' \
    --output-text-file='' \
    --http-cache-dir='' \
    --workers=2 \
    --max-reqs-per-sec=5 \
    --hide-progress-bar \
    --no-color

  test -s "$output"
}

wqt_run_lighthouse() {
  if [[ "$#" -ne 2 ]]; then
    echo "wqt_run_lighthouse requires: <validated-origin> <output-path>" >&2
    return 2
  fi

  local target="$1"
  local output="$2"
  local lighthouse_bin="${WQT_SCANNER_ROOT_DIR}/node_modules/.bin/lighthouse"
  local chrome_path="${CHROME_PATH:-}"

  if [[ -z "$target" || -z "$output" ]]; then
    echo "wqt_run_lighthouse requires non-empty validated origin and output path" >&2
    return 2
  fi
  if [[ ! -x "$lighthouse_bin" ]]; then
    echo "Lighthouse CLI not installed at ${lighthouse_bin}" >&2
    return 1
  fi

  if [[ -z "$chrome_path" ]]; then
    local candidate
    for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
      if command -v "$candidate" >/dev/null 2>&1; then
        chrome_path="$(command -v "$candidate")"
        break
      fi
    done
  fi
  if [[ -z "$chrome_path" || ! -x "$chrome_path" ]]; then
    echo "No supported Chrome/Chromium executable found for Lighthouse" >&2
    return 1
  fi

  mkdir -p "$(dirname "$output")"
  "$chrome_path" --version
  CHROME_PATH="$chrome_path" "$lighthouse_bin" "$target" \
    --preset=desktop \
    --only-categories=performance,accessibility,best-practices,seo \
    --output=json \
    --output-path="$output" \
    --quiet \
    --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu"

  test -s "$output"
}
