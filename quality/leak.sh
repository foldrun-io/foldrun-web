#!/usr/bin/env bash
# Nothing hosted-only in the open-source image (27 Oct 2026). The image the
# self-hosting build made must hold none of foldrun's private files —
# billing, Stripe, the operator console — by name, and no secret by
# pattern (gitleaks over its filesystem).
#
#   bash quality/stack.sh up && bash quality/leak.sh [image]
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
IMAGE=${1:-foldrun-self-hosted:local}
WEB=$(cd "$QUALITY_DIR/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
# The private names, from the same lists the boundary tests use.
python3 - "$WEB/../foldrun-platform/tests/billing-boundary-lists.ts" "$WEB/tests/billing-files.ts" > "$tmp/names" <<'PY'
import re, sys
names = set()
for f in sys.argv[1:]:
    try: names |= set(re.findall(r'"([a-z0-9][a-z0-9./_-]+)"', open(f).read()))
    except FileNotFoundError: pass
for n in sorted(names):
    if len(n) > 3: print(n)
PY
# Only /app — the platform's own files — and the extraction must succeed: a
# failed or partial copy scanned clean would be a false all-clear (Codex
# review).
cid=$(docker create "$IMAGE")
if ! docker cp "$cid:/app" "$tmp/app"; then docker rm "$cid" >/dev/null; echo "LEAK-CHECK FAILED: could not copy /app out of $IMAGE"; exit 1; fi
docker rm "$cid" >/dev/null
for d in foldrun-core foldrun-platform foldrun-web; do
  [ -d "$tmp/app/$d" ] || { echo "LEAK-CHECK FAILED: $IMAGE has no /app/$d — not the image this scan is for"; exit 1; }
done
[ "$(find "$tmp/app" -type f | wc -l)" -gt 1000 ] || { echo "LEAK-CHECK FAILED: /app holds too few files to be a real image"; exit 1; }
found=0
# Directory entries (app/admin/, server/admin/, app/api/billing/): the
# directory must not exist in the image at all (Codex review).
while read -r d; do
  hit=$(find "$tmp/app" -path '*/node_modules' -prune -o -type d -path "*/foldrun-*/${d%/}" -print 2>/dev/null | head -3 || true)
  [ -n "$hit" ] && { echo "LEAK directory $d → $hit"; found=1; }
done < <(grep '/$' "$tmp/names" || true)
while read -r n; do
  base=${n##*/}
  for ext in "" .ts .tsx .js .mjs; do
    hit=$(find "$tmp/app" -path '*/node_modules' -prune -o -name "${base%.ts*}$ext" -print 2>/dev/null | grep -v -e /tests/ -e billing-hosted -e billing-slots -e billing-notices | head -3 || true)
    [ -n "$hit" ] && { echo "LEAK $n → $hit"; found=1; }
  done
done < <(grep -v -e '^billing-hosted' -e 'test.ts$' -e '/$' "$tmp/names")
for marker in "STRIPE_PRICE_STARTER" "createSubscriptionSession" "consoleAllows"; do
  hit=$(grep -rl --exclude-dir=node_modules "$marker" "$tmp/app" 2>/dev/null | grep -v -e '\.md$' | head -3 || true)
  [ -n "$hit" ] && { echo "LEAK marker '$marker' in: $hit"; found=1; }
done
docker run --rm -v "$tmp/app:/scan:ro" -v "$QUALITY_DIR/gitleaks.toml:/cfg.toml:ro" zricethezav/gitleaks:v8.28.0 dir /scan --config /cfg.toml --no-banner --redact >/dev/null 2>"$tmp/gl" || { echo "LEAK gitleaks found a secret in the image:"; tail -20 "$tmp/gl"; found=1; }
[ "$found" = 0 ] && echo "leak: ok — no private file, marker or secret in $IMAGE" || exit 1
