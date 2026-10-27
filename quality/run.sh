#!/usr/bin/env bash
# The quality suites, in order, on one stack (27 Oct 2026):
#
#   bash quality/run.sh                      # the per-push set
#   bash quality/run.sh all                  # everything but soak
#   bash quality/run.sh e2e load:stress dast # any list
#
# Suites: e2e, races, chaos, fuzz, dast, browser, leak, load:<smoke|load|stress|spike|soak>.
# Starts the stack, runs each suite, always stops the stack, exits 1 if any
# failed, and prints one line per suite at the end.
set -uo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
case "${1:-push}" in
  push) set -- e2e races leak load:smoke browser ;;
  # Fuzz last: it sends random writes to every route, and anything it
  # changes (a pause, a setting) must not decide a later suite.
  all)  set -- e2e races leak load:smoke browser chaos load:load load:spike load:stress e2e dast fuzz ;;
esac
# Torn down however this ends — a finished run, a failed one, or Ctrl-C
# (Codex review: an interrupted run left a stack whose next start failed).
trap 'bash "$QUALITY_DIR/stack.sh" down >/dev/null 2>&1' EXIT
trap 'exit 130' INT TERM
bash "$QUALITY_DIR/stack.sh" up || { bash "$QUALITY_DIR/stack.sh" logs 200; exit 1; }
# shellcheck disable=SC1091
. "$QUALITY_DIR/.state/env"
export QUALITY_URL QUALITY_TOKEN QUALITY_EMAIL QUALITY_PASSWORD
results=()
fail=0
for s in "$@"; do
  echo "=== $s"
  start=$SECONDS
  case "$s" in
    load:*) docker run --rm --network host -e QUALITY_URL -e QUALITY_TOKEN -e "QUALITY_WS=${QUALITY_WS:-quality-load}" -e "PROFILE=${s#load:}" \
              -v "$QUALITY_DIR/load.k6.js:/q/load.k6.js:ro" grafana/k6:latest run --quiet /q/load.k6.js ;;
    *) bash "$QUALITY_DIR/$s.sh" ;;
  esac
  rc=$?
  results+=("$( [ $rc = 0 ] && echo PASS || echo FAIL ) $s ($((SECONDS - start))s)")
  [ $rc = 0 ] || fail=1
done
[ "$fail" = 0 ] || bash "$QUALITY_DIR/stack.sh" logs 150
# Reports outlive the stack (CI keeps them); never the env files with keys.
mkdir -p "$QUALITY_DIR/reports"
cp -r "$QUALITY_DIR/.state/zap" "$QUALITY_DIR/.state/fuzz.log" "$QUALITY_DIR/reports/" 2>/dev/null || true
printf '%s\n' "${results[@]}" > "$QUALITY_DIR/reports/summary.txt"
echo; echo "=== quality summary"; printf '%s\n' "${results[@]}"
exit $fail
