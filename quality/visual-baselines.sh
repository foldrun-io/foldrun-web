#!/usr/bin/env bash
# Bring the baselines an update run made in CI into quality/visual/baselines
# (FOL-196). Baselines are made on CI's Linux, never on a laptop: a Mac's
# fonts and renderer differ, and every compare would fail.
#
#   GH_TOKEN=… bash quality/visual-baselines.sh <run-id>
#
# <run-id> is a quality workflow run started with suites "visual:update"
# (Actions → quality → Run workflow, on your branch). Then look at the new
# pictures (git diff shows which changed), commit them with the change that
# made them, and say so in the commit.
set -euo pipefail
run=${1:?usage: GH_TOKEN=… quality/visual-baselines.sh <run-id>}
: "${GH_TOKEN:?a GitHub token that can read the artifacts of this repository}"
REPO=${REPO:-foldrun-io/foldrun-web}
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
api() { curl -fsSL -H "authorization: Bearer $GH_TOKEN" -H "accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/$1"; }
id=$(api "actions/runs/$run/artifacts" | python3 -c 'import sys,json; a=[x for x in json.load(sys.stdin)["artifacts"] if x["name"]=="quality-reports"]; print(a[0]["id"] if a else "")')
[ -n "$id" ] || { echo "run $run has no quality-reports artifact" >&2; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
# The download redirects to storage that refuses the GitHub token: follow it bare.
loc=$(curl -fsS -o /dev/null -w '%{redirect_url}' -H "authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/$REPO/actions/artifacts/$id/zip")
curl -fsSL -o "$tmp/a.zip" "$loc"
(cd "$tmp" && unzip -q a.zip)
n=$(find "$tmp/visual-baselines" -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -gt 0 ] || { echo "run $run made no baselines (was it a visual:update run?)" >&2; exit 1; }
mkdir -p "$QUALITY_DIR/visual/baselines"
rm -f "$QUALITY_DIR/visual/baselines/"*.png
cp "$tmp/visual-baselines/"*.png "$QUALITY_DIR/visual/baselines/"
echo "visual: $n baselines from run $run in quality/visual/baselines"
git -C "$QUALITY_DIR/.." status --short -- quality/visual/baselines
