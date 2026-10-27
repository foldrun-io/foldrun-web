#!/usr/bin/env bash
# Chaos (27 Oct 2026): the platform is restarted while runs are in flight.
# Every run must end — completed, or failed with a reason — never stuck
# "running" for ever, and the platform must come back by itself.
#
#   bash quality/stack.sh up && bash quality/e2e.sh && bash quality/chaos.sh
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$QUALITY_DIR/.state/env"
WS=${QUALITY_WS:-quality-load}
api() { local p=$1; shift; curl -sS -H "authorization: Bearer $QUALITY_TOKEN" -H "content-type: application/json" "$QUALITY_URL/api/$p" "$@"; }
# The fake model answers at once, so a run could end before the restart and
# the test would prove nothing (Codex review): the platform is recreated on
# the slow model — 20 s a call — for this suite, and put back after.
# Recreated, then ready: the platform has no Compose healthcheck, so --wait
# only means "running" — the API is polled before anything is sent (Codex).
healthy() { for _ in $(seq 1 90); do curl -fsS "$QUALITY_URL/api/healthz" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }
slow() { QUALITY_MODEL_URL="$1" bash "$QUALITY_DIR/stack.sh" compose up -d --wait platform >/dev/null 2>&1; healthy; }
trap 'slow http://fake-model:8080/model' EXIT
slow http://fake-model:8080/slow-model/20000
runs=()
for i in 1 2 3; do
  ans=$(api "workspaces/$WS/flows/hello/run" -X POST -H "idempotency-key: chaos-$i-$(date +%s)" -d '{}')
  id=$(printf '%s' "$ans" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("runId") or "")' 2>/dev/null || true)
  [ -n "$id" ] && runs+=("$id") || echo "chaos: start $i refused: ${ans:0:300}"
done
[ "${#runs[@]}" = 3 ] || { echo "FAIL could not start the runs"; exit 1; }
# Proof the restart lands mid-run: every run is running (in its model call).
for _ in $(seq 1 30); do
  busy=0
  for r in "${runs[@]}"; do
    s=$(api "workspaces/$WS/runs/$r" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("run") or d).get("status",""))')
    [ "$s" = running ] && busy=$((busy + 1))
  done
  [ "$busy" = 3 ] && break
  sleep 1
done
[ "$busy" = 3 ] || { echo "FAIL the runs were not all running before the restart ($busy of 3)"; exit 1; }
echo "chaos: restarting the platform with ${#runs[@]} runs in flight"
bash "$QUALITY_DIR/stack.sh" compose restart platform >/dev/null
for _ in $(seq 1 90); do curl -fsS "$QUALITY_URL/api/healthz" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "$QUALITY_URL/api/healthz" >/dev/null || { echo "FAIL the platform did not come back"; exit 1; }
deadline=$((SECONDS + 600)); left=("${runs[@]}")
while [ "${#left[@]}" -gt 0 ] && [ "$SECONDS" -lt "$deadline" ]; do
  still=()
  for r in "${left[@]}"; do
    s=$(api "workspaces/$WS/runs/$r" | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("run") or d).get("status",""))')
    case "$s" in completed|failed|stopped) echo "chaos: $r ended $s" ;; *) still+=("$r") ;; esac
  done
  left=("${still[@]+"${still[@]}"}"); [ "${#left[@]}" -gt 0 ] && sleep 5
done
[ "${#left[@]}" = 0 ] || { echo "FAIL runs still not ended 10 minutes after the restart: ${left[*]}"; exit 1; }
echo "chaos: ok — every run ended after the restart"
