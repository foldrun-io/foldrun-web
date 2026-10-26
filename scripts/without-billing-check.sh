#!/usr/bin/env bash
# Build and test foldrun as a public checkout has it: without billing.
#
#   bash scripts/without-billing-check.sh [out-dir]
#
# Lays the checkout out with scripts/without-billing.mjs, then in it:
# typechecks and tests foldrun-platform, typechecks, tests and builds
# foldrun-web, and fails if the built server code still names a billing
# module or function — an alarm on top of the build itself.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$(mktemp -d "${TMPDIR:-/tmp}/foldrun-without-billing-XXXXXX")}"
web="$(basename "$here")"

node "$here/scripts/without-billing.mjs" "$out"
for repo in foldrun-core foldrun-platform foldrun-docs foldrun-cli "$web"; do
  [ -f "$out/$repo/package-lock.json" ] || continue
  echo "== $repo: npm ci"
  (cd "$out/$repo" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error)
done

# The end-to-end suite drives the real CLI, which must load THIS core (its
# compiled dist), as the box deploy arranges it.
if [ -d "$out/foldrun-cli" ]; then
  (cd "$out/foldrun-cli" && rm -rf node_modules/@foldrun/core && mkdir -p node_modules/@foldrun && ln -s ../../../foldrun-core node_modules/@foldrun/core)
  (cd "$out/foldrun-core" && npx tsc -p tsconfig.json)
fi

echo "== foldrun-platform: typecheck"
(cd "$out/foldrun-platform" && npx tsc --noEmit -p .)
echo "== foldrun-platform: tests"
(cd "$out/foldrun-platform" && FOLDRUN_DATA="$(mktemp -d)" node --test --test-timeout=180000 $(ls tests/*.test.ts | grep -v e2e))

echo "== $web: typecheck"
(cd "$out/$web" && npm run --silent typecheck)
echo "== $web: tests"
(cd "$out/$web" && FOLDRUN_DATA="$(mktemp -d)" node --import ./tests/register.mjs --test $(ls tests/*.test.ts | grep -v e2e))
echo "== $web: next build"
(cd "$out/$web" && npx next build >/dev/null)

echo "== $web: end to end (a production server, the real HTTP surface and CLI)"
(cd "$out/$web" && FOLDRUN_API_E2E=1 node --test --test-timeout=300000 tests/api-e2e.test.ts)

echo "== $web: no billing in the built server"
# An alarm, not a proof: names only billing's modules define, searched in
# the compiled server code (not prerendered docs pages, which may name an
# env var in prose). What proves the split is above — the checkout has no
# billing file, and it typechecks, tests and builds.
server="$out/$web/.next/server"
files="$(find "$server" -name '*.js' 2>/dev/null | wc -l | tr -d ' ')"
if [ "${files:-0}" -lt 100 ]; then
  echo "only ${files:-0} compiled server files under $server — the build did not produce what this scan reads" >&2
  exit 1
fi
names='creditBalance|recordTopUp|expirePurchasedCredits|walletGuard|dunningTick|renewAdminPlan|stripeRequest|priceConfig|ledgerSummary|adminOverdraft'
set +e
hits="$(grep -rlE --include='*.js' "$names" "$server")"
status=$?
set -e
if [ "$status" -eq 0 ]; then
  echo "$hits" | head -5
  echo "billing code found in the build above" >&2
  exit 1
elif [ "$status" -ne 1 ]; then
  echo "the scan itself failed (grep exit $status)" >&2
  exit 1
fi
echo "without-billing: platform and web typecheck, test and build with no billing — $out ($files server files scanned)"
