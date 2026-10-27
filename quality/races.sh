#!/usr/bin/env bash
# Concurrency (27 Oct 2026): many identical writes at the same instant must
# do the thing once. Twenty starts of a flow sharing one Idempotency-Key make
# one run, and every answer names that run.
#
#   bash quality/stack.sh up && bash quality/e2e.sh && bash quality/races.sh
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$QUALITY_DIR/.state/env"
WS=${QUALITY_WS:-quality-load}
key="race-$(date +%s)-$RANDOM"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
# Counted by start time, not by list length: the listing is capped, so on a
# busy stack two full pages look the same (Codex review).
t0=$(python3 -c 'import datetime; print(datetime.datetime.now(datetime.timezone.utc).isoformat())')
since() { curl -sS -H "authorization: Bearer $QUALITY_TOKEN" "$QUALITY_URL/api/workspaces/$WS/runs?limit=200" | python3 -c '
import sys, json
d = json.load(sys.stdin); runs = d.get("runs", d) if isinstance(d, dict) else d
print(sum(1 for r in runs if (r.get("startedAt") or "") >= sys.argv[1]))' "$t0"; }
before=$(since)
# A 409 with Retry-After is the right answer while the first of the same
# key is still in flight (server/idempotency.ts): a client retries it, so
# this does too, and only the final answers are judged (Codex review).
one() {
  local i=$1 code
  for _ in $(seq 1 20); do
    code=$(curl -sS -o "$tmp/$i" -w '%{http_code}' -H "authorization: Bearer $QUALITY_TOKEN" -H "content-type: application/json" \
      -H "idempotency-key: $key" -X POST -d '{}' "$QUALITY_URL/api/workspaces/$WS/flows/hello/run")
    [ "$code" = 409 ] || break
    sleep 1
  done
  echo "$code" > "$tmp/$i.code"
}
for i in $(seq 1 20); do one "$i" & done
wait
sleep 3
after=$(since)
ids=$(cat "$tmp"/[0-9]* | python3 -c '
import sys, json, re
ids = set(re.findall(r"run-[a-z0-9]+-[a-z0-9]+", sys.stdin.read()))
print(" ".join(sorted(ids)))')
codes=$(cat "$tmp"/*.code | sort | uniq -c | tr '\n' ' ')
echo "races: answers $codes; run ids seen: ${ids:-none}; runs before $before, after $after"
[ "$((after - before))" = 1 ] || { echo "FAIL twenty identical starts made $((after - before)) runs"; exit 1; }
# Every answer a success that names the run — a 500 among them is a failure
# even when the count comes out right (Codex review).
bad=$(cat "$tmp"/*.code | grep -cvE '^(200|201|202)$' || true)
[ "$bad" = 0 ] || { echo "FAIL $bad of the twenty answers were not a success"; exit 1; }
[ "$(echo "$ids" | wc -w | tr -d ' ')" = 1 ] || { echo "FAIL the answers should all name one run, named: ${ids:-none}"; exit 1; }
for i in $(seq 1 20); do grep -q "$ids" "$tmp/$i" || { echo "FAIL answer $i does not name the run"; exit 1; }; done
echo "races: ok — one key, one run"
