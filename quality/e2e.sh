#!/usr/bin/env bash
# End to end on the quality stack, the way a self-hosting user works: the
# published CLI deploys a workspace, a flow runs in a real run container
# against the fake model, and its result comes back through the API.
#
#   bash quality/stack.sh up && bash quality/e2e.sh
#
# CLI: `foldrun` from npm (QUALITY_CLI=latest, or a version), in a Node
# container on the host network — the runner needs only Docker.
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$QUALITY_DIR/.state/env"
CLI_VERSION=${QUALITY_CLI:-latest}
NODE_IMAGE=${QUALITY_NODE_IMAGE:-node:22-slim}
WS=${QUALITY_WS:-quality-load}
fails=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
api() { local p=$1; shift; curl -sS -H "authorization: Bearer $QUALITY_TOKEN" -H "content-type: application/json" "$QUALITY_URL/api/$p" "$@"; }

cli() {
  docker run --rm --network host \
    -e FOLDRUN_URL="$QUALITY_URL" -e FOLDRUN_TOKEN="$QUALITY_TOKEN" -e NO_COLOR=1 \
    -v "$QUALITY_DIR/fixtures:/fixtures:ro" -w /fixtures \
    "$NODE_IMAGE" npx -y "foldrun@$CLI_VERSION" "$@"
}

# 1. The CLI checks and deploys the workspace.
cli check /fixtures/hello >/dev/null && ok "foldrun check passes on the fixture" || bad "foldrun check"
cli deploy /fixtures/hello --to "$WS" --yes >/dev/null && ok "foldrun deploy lands the workspace" || bad "foldrun deploy"
api "workspaces/$WS/flows" | grep -q '"hello"' && ok "the deployed flow is listed" || bad "flow not listed after deploy"

# 2. A run, end to end, waited on.
body=$(api "workspaces/$WS/flows/hello/run?wait=true&timeout=300" -X POST -H "idempotency-key: quality-e2e-$(date +%s)" -d '{}' -w '\n%{http_code}')
code=${body##*$'\n'}
json=${body%$'\n'*}
[ "$code" = 200 ] && ok "the run finished (HTTP 200)" || bad "the run: HTTP $code: ${json:0:400}"
printf '%s' "$json" | grep -q "QUALITY-OK" && ok "the step's answer came from the model through the run container" || bad "no model answer in the result: ${json:0:400}"
run=$(printf '%s' "$json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("runId") or (d.get("run") or {}).get("id") or "")' 2>/dev/null || true)

# 3. The record says the same.
if [ -n "$run" ]; then
  rec=$(api "workspaces/$WS/runs/$run")
  printf '%s' "$rec" | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get("run",d); sys.exit(0 if r.get("status")=="completed" else 1)' \
    && ok "the run record is completed" || bad "run record: ${rec:0:300}"
else
  bad "no run id in the answer"
fi

# 4. The workspace goes away cleanly — last, when nothing else needs it.
if [ "${QUALITY_DELETE:-0}" = 1 ]; then
  api "workspaces/$WS" -X DELETE -o /dev/null -w '%{http_code}' | grep -qE '^20' && ok "the workspace deletes" || bad "workspace delete"
fi

[ "$fails" = 0 ] && echo "e2e: all ok" || { echo "e2e: $fails failed"; exit 1; }
