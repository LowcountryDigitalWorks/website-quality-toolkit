#!/usr/bin/env bash
set -euo pipefail

SITE_IDENTIFIER="${1:-}"

case "$SITE_IDENTIFIER" in
  lowcountrydigitalworks)
    printf '%s\n' 'https://lowcountrydigitalworks.com'
    ;;
  donovanfamilydentistry)
    printf '%s\n' 'https://donovanfamilydentistry.com'
    ;;
  '')
    echo 'Site identifier is required; no default or free-form target is permitted.' >&2
    exit 2
    ;;
  *)
    printf 'Unauthorized site identifier: %s\n' "$SITE_IDENTIFIER" >&2
    exit 2
    ;;
esac
