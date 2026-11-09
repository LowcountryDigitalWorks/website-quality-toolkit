#!/usr/bin/env bash
set -euo pipefail

SITEONE_VERSION="2.5.1"
ARCHIVE_NAME="siteone-crawler-v${SITEONE_VERSION}-linux-x64.tar.gz"
DOWNLOAD_URL="https://github.com/janreges/siteone-crawler/releases/download/v${SITEONE_VERSION}/${ARCHIVE_NAME}"
# Fixed identity from the same upstream GitHub v2.5.1 release; never discover
# an arbitrary asset ID dynamically or fetch from an alternate publisher.
ASSET_API_URL="https://api.github.com/repos/janreges/siteone-crawler/releases/assets/459279687"
EXPECTED_SHA256="09278d958d4a087fa46093805cd33b085b96618001dd31d45c448ad724c9024e"
EXPECTED_BYTES=10876162
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${1:-${ROOT_DIR}/tools/bin}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

archive_path="${WORK_DIR}/${ARCHIVE_NAME}"
extract_dir="${WORK_DIR}/extract"
mkdir -p "$extract_dir" "$DEST_DIR"

# GitHub's releases/download CDN path can 504 while the first-party asset
# API remains accessible. Both paths lead to the SAME pinned upstream artifact.
# The alternate route is used only after a transport failure, never after a
# checksum/size mismatch. No token, third-party mirror or unpinned fallback.
if ! curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location \
  --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 90 --max-filesize 20000000 \
  --output "$archive_path" "$DOWNLOAD_URL"; then
  rm -f "$archive_path"
  echo "SiteOne upstream release transport unavailable; trying pinned official GitHub asset API." >&2
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location \
    --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 90 --max-filesize 20000000 \
    --header 'Accept: application/octet-stream' \
    --output "$archive_path" "$ASSET_API_URL"
fi

# API metadata JSON, wrong asset, partial download and tampered content all fail
# closed before extraction. The accepted binary is never installed on failure.
test "$(stat -c '%s' "$archive_path")" -eq "$EXPECTED_BYTES"
printf '%s  %s\n' "$EXPECTED_SHA256" "$archive_path" | sha256sum --check --strict

tar -xzf "$archive_path" -C "$extract_dir"
source_binary="$(find "$extract_dir" -type f -name 'siteone-crawler' -print -quit)"
if [[ -z "$source_binary" ]]; then
  echo "Verified archive did not contain a siteone-crawler binary" >&2
  exit 1
fi

install -m 0755 "$source_binary" "${DEST_DIR}/siteone-crawler"
test -x "${DEST_DIR}/siteone-crawler"

# The immutable versioned release URL plus upstream-published digest establishes
# exact artifact identity. PR validation stops here: no crawler execution and no
# production-site request occurs until an authorized scan job runs.
printf 'Verified SiteOne Crawler artifact %s (%s)\n' "$SITEONE_VERSION" "$EXPECTED_SHA256"
