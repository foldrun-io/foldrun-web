#!/usr/bin/env bash
# The visual suite (FOL-196): key dashboard pages, light and dark, compared
# with the baselines in quality/visual/baselines. Inside Microsoft's
# Playwright image, on the host network, against the quality stack — the
# same browser and fonts wherever it runs, so a baseline made in CI holds.
#
#   bash quality/visual.sh                 # compare; a difference fails
#   VISUAL_UPDATE=1 bash quality/visual.sh # write new baselines instead
#
# Either way the shots land in quality/reports/visual (for a difference:
# <page>-actual.png, -expected.png and -diff.png), and an update's new
# baselines in quality/reports/visual-baselines — CI uploads both as the
# quality-reports artifact; quality/visual-baselines.sh brings them home.
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
set -a  # exported: docker -e passes them by name
# shellcheck disable=SC1091
. "$QUALITY_DIR/.state/env"
set +a
V=${QUALITY_PLAYWRIGHT:-1.64.1}
REPORTS="$QUALITY_DIR/reports"
rm -rf "$REPORTS/visual" "$REPORTS/visual-baselines"
mkdir -p "$REPORTS/visual" "$REPORTS/visual-baselines" "$QUALITY_DIR/visual/baselines"
if [ "${VISUAL_UPDATE:-0}" = 1 ]; then
  flags="--update-snapshots=all"
else
  # No baseline is a failure, not a silent first write: a page added to the
  # suite gets its baseline through an update run like any other change.
  flags="--update-snapshots=none"
  compgen -G "$QUALITY_DIR/visual/baselines/*.png" >/dev/null || { echo "visual: no baselines in quality/visual/baselines — make them with an update run (quality/README.md)" >&2; exit 1; }
fi
docker run --rm --network host --ipc=host \
  -e QUALITY_URL -e QUALITY_EMAIL -e QUALITY_PASSWORD -e "QUALITY_WS=${QUALITY_WS:-quality-load}" \
  -e "FLAGS=$flags" -e "UPDATE=${VISUAL_UPDATE:-0}" \
  -v "$QUALITY_DIR/visual:/src:ro" -v "$REPORTS:/reports" \
  "mcr.microsoft.com/playwright:v$V-noble" \
  bash -c "set -e; cp -r /src /work; cd /work; npm init -y >/dev/null; npm i --silent @playwright/test@$V >/dev/null
    rc=0; npx playwright test -c visual.config.mjs \$FLAGS || rc=\$?
    if [ \"\$UPDATE\" = 1 ]; then cp baselines/*.png /reports/visual-baselines/ 2>/dev/null || true; fi
    chmod -R a+rwX /reports; exit \$rc"
