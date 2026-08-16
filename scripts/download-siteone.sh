#!/usr/bin/env bash
set -euo pipefail

SITEONE_VERSION="2.5.1"
ARCHIVE_NAME="siteone-crawler-v${SITEONE_VERSION}-linux-x64.tar.gz"
DOWNLOAD_URL="https://github.com/janreges/siteone-crawler/releases/download/v${SITEONE_VERSION}/${ARCHIVE_NAME}"
EXPECTED_SHA256="09278d958d4a087fa46093805cd33b085b96618001dd31d45c448ad724c9024e"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${1:-${ROOT_DIR}/tools/bin}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

archive_path="${WORK_DIR}/${ARCHIVE_NAME}"
extract_dir="${WORK_DIR}/extract"
mkdir -p "$extract_dir" "$DEST_DIR"

curl --proto '=https' --tlsv1.2 --fail --location --retry 3 --retry-delay 2 \
  --output "$archive_path" "$DOWNLOAD_URL"
printf '%s  %s\n' "$EXPECTED_SHA256" "$archive_path" | sha256sum --check --strict

tar -xzf "$archive_path" -C "$extract_dir"
source_binary="$(find "$extract_dir" -type f -name 'siteone-crawler' -print -quit)"
if [[ -z "$source_binary" ]]; then
  echo "Verified archive did not contain a siteone-crawler binary" >&2
  exit 1
fi

install -m 0755 "$source_binary" "${DEST_DIR}/siteone-crawler"

# The immutable release URL plus upstream-published digest establishes the exact
# artifact identity. Execute only after verification, using --help as a bounded
# smoke check that does not crawl a target.
"${DEST_DIR}/siteone-crawler" --help >/dev/null
printf 'Verified SiteOne Crawler %s (%s)\n' "$SITEONE_VERSION" "$EXPECTED_SHA256"
