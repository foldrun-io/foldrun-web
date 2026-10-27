#!/usr/bin/env bash
# An outside attacker's first look (27 Oct 2026): OWASP ZAP's baseline scan —
# spider the stack, passively check every response (headers, cookies, CSP,
# leaks in bodies). Any medium or high finding fails the run unless
# quality/zap-rules.tsv accepts its rule, with the reason.
#
#   bash quality/stack.sh up && bash quality/dast.sh
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$QUALITY_DIR/.state/env"
IMAGE=${QUALITY_ZAP_IMAGE:-zaproxy/zap-stable}
out="$QUALITY_DIR/.state/zap"
mkdir -p "$out" && chmod 777 "$out"
docker run --rm --network host -v "$out:/zap/wrk:rw" -v "$QUALITY_DIR/zap-rules.tsv:/zap/wrk/rules.tsv:ro" "$IMAGE" \
  zap-baseline.py -t "$QUALITY_URL" -c rules.tsv -r report.html -J report.json -m 3 -I
python3 - "$out/report.json" "$QUALITY_DIR/zap-rules.tsv" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
accepted = {l.split("\t")[0] for l in open(sys.argv[2]) if l.strip() and not l.startswith("#")}
bad = [a for s in r.get("site", []) for a in s.get("alerts", []) if a.get("riskcode") in ("2", "3") and a.get("pluginid") not in accepted]
for a in bad: print(f"{'HIGH' if a['riskcode'] == '3' else 'MEDIUM'}  {a['pluginid']} {a['alert']} (×{a.get('count')}) e.g. {a['instances'][0]['uri'] if a.get('instances') else ''}")
sys.exit(1 if bad else 0)
PY
echo "dast: no medium or high finding beyond quality/zap-rules.tsv (report: quality/.state/zap/report.html)"
