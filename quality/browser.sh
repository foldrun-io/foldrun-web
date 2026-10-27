#!/usr/bin/env bash
# Runs quality/browser.mjs in Microsoft's Playwright image (browsers
# included), on the host network, against the quality stack.
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
set -a  # exported: docker -e passes them by name
# shellcheck disable=SC1091
. "$QUALITY_DIR/.state/env"
set +a
V=${QUALITY_PLAYWRIGHT:-1.64.1}
docker run --rm --network host --ipc=host \
  -e QUALITY_URL -e QUALITY_EMAIL -e QUALITY_PASSWORD -e QUALITY_TOKEN -e "QUALITY_WS=${QUALITY_WS:-quality-load}" \
  -v "$QUALITY_DIR/browser.mjs:/q/browser.mjs:ro" -w /q \
  "mcr.microsoft.com/playwright:v$V-noble" \
  bash -c "npm init -y >/dev/null && npm i --silent playwright@$V >/dev/null && node browser.mjs"
