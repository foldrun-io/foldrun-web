#!/usr/bin/env bash
# The API against its own contract (27 Oct 2026): Schemathesis generates
# requests from /api/openapi.json — valid and hostile — and this fails on any
# 5xx or any status code the document does not list. Routes that would
# destroy the test's own footing (keys, the account, the team, sign-in) are
# left out; everything else is fair game, on a throwaway stack.
#
# One exception, named: TRACE, TRACK and CONNECT. The Fetch standard forbids
# them, Node's Request refuses to construct one, and Next.js answers 500
# ("Internal Server Error", nothing else) before any foldrun code runs. The
# hosted edge answers them 405; a self-hosted install behind its own proxy
# should do the same (self-hosting docs).
#
#   bash quality/stack.sh up && bash quality/fuzz.sh [max-examples]
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$QUALITY_DIR/.state/env"
IMAGE=${QUALITY_SCHEMATHESIS_IMAGE:-schemathesis/schemathesis:stable}
log="$QUALITY_DIR/.state/fuzz.log"
docker run --rm --network host "$IMAGE" run "$QUALITY_URL/api/openapi.json" \
  --header "Authorization: Bearer $QUALITY_TOKEN" \
  --checks not_a_server_error,response_schema_conformance,status_code_conformance \
  --exclude-path-regex '^/api/(keys|account|team|auth|me/mfa|admin|billing)' \
  --exclude-method DELETE \
  --max-examples "${1:-25}" \
  --request-timeout 30 \
  --workers 2 > "$log" 2>&1 || true
python3 - "$log" <<'PY'
import re, sys, collections
log = open(sys.argv[1]).read()
if "SUMMARY" not in log:
    print(log[-3000:]); sys.exit("fuzz: Schemathesis did not finish")
FORBIDDEN = {"TRACE", "TRACK", "CONNECT"}
server, undocumented, forbidden = collections.Counter(), collections.Counter(), 0
for case in re.split(r"\n\d+\. Test Case ID: \w+\n", log):
    cu = re.search(r"curl -X (\w+)[^\n]*?'?(http://[^ '\n]+)", case)
    where = (cu.group(1) + " " + re.sub(r"\?.*", "", cu.group(2).split("/", 3)[-1])) if cu else "?"
    if re.search(r"\n\[5\d\d\]", case):
        if cu and cu.group(1) in FORBIDDEN: forbidden += 1
        else: server[where] += 1
    for got, doc in re.findall(r"Received: (\d+)\n\s+Documented: ([^\n]+)", case):
        undocumented[f"{where} → {got} (documented {doc})"] += 1
# Every failure kind in the summary must be explained: ST101 (server error)
# only by the forbidden methods, ST103 (undocumented status) never, and any
# other kind — a response that breaks its schema, an execution error — always
# fails (Codex review).
kinds = dict((k, int(n)) for k, n in re.findall(r"❌ (ST\d+)[^:\n]*: (\d+)", log))
other = {k: n for k, n in kinds.items() if k not in ("ST101", "ST103")}
if kinds.get("ST101", 0) > forbidden + sum(server.values()):
    server["(server errors the per-case parse could not place)"] += kinds["ST101"] - forbidden - sum(server.values())
if kinds.get("ST103", 0) and not undocumented:
    undocumented["(undocumented statuses the per-case parse could not place)"] = kinds["ST103"]
if re.search(r"(?m)^\s*(Errors|Execution errors?):", log): other["errors during the run"] = 1
ops = re.search(r"Tested: (\d+)", log)
cases = re.search(r"(\d+) generated", log)
print(f"fuzz: {ops.group(1) if ops else '?'} operations, {cases.group(1) if cases else '?'} requests; "
      f"{forbidden} answered 500 to a Fetch-forbidden method (Next.js, accepted)")
for k, n in server.most_common(): print(f"SERVER ERROR ×{n}  /{k}")
for k, n in undocumented.most_common(): print(f"UNDOCUMENTED ×{n}  /{k}")
for k, n in other.items(): print(f"FAILURE {k} ×{n} (see quality/.state/fuzz.log)")
sys.exit(1 if server or undocumented or other else 0)
PY
echo "fuzz: ok — no server error, every status documented (log: quality/.state/fuzz.log)"
