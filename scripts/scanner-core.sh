#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "scanner-core.sh is a library-only module; source it from an authorized target wrapper." >&2
  exit 2
fi

WQT_SCANNER_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_siteone_for_origin() {
  if [[ "$#" -ne 2 ]]; then
    echo "run_siteone_for_origin requires an already-validated origin and output path" >&2
    return 2
  fi

  local target="$1"
  local output="$2"
  local binary="${SITEONE_BIN:-${WQT_SCANNER_ROOT_DIR}/tools/bin/siteone-crawler}"

  if [[ ! -x "$binary" ]]; then
    echo "SiteOne binary not found or not executable: ${binary}" >&2
    return 1
  fi

  mkdir -p "$(dirname "$output")" || return $?

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
    --no-color || return $?

  test -s "$output"
}

run_lighthouse_for_origin() {
  if [[ "$#" -ne 2 ]]; then
    echo "run_lighthouse_for_origin requires an already-validated origin and output path" >&2
    return 2
  fi

  local target="$1"
  local output="$2"
  local lighthouse_bin="${WQT_SCANNER_ROOT_DIR}/node_modules/.bin/lighthouse"

  if [[ ! -x "$lighthouse_bin" ]]; then
    echo "Lighthouse CLI not installed at ${lighthouse_bin}" >&2
    return 1
  fi

  if [[ -z "${CHROME_PATH:-}" ]]; then
    local candidate
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
    return 1
  fi

  mkdir -p "$(dirname "$output")" || return $?
  "$CHROME_PATH" --version || return $?
  "$lighthouse_bin" "$target" \
    --preset=desktop \
    --only-categories=performance,accessibility,best-practices,seo \
    --output=json \
    --output-path="$output" \
    --quiet \
    --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu" || return $?

  test -s "$output"
}
