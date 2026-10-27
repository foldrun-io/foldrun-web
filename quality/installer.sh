#!/usr/bin/env bash
# "Works out of the box" (27 Oct 2026): the one-line install exactly as a
# stranger runs it — `curl -fsSL https://foldrun.io/install.sh | sh` — pulling
# the PUBLISHED images, then sign-up with the setup token the installer
# wrote, a deploy with the published CLI, and a run (against a fake model,
# so no key and no tokens). Then the install is removed.
#
#   bash quality/installer.sh            # foldrun.io's installer, stable images
#   QUALITY_INSTALL_URL=file:///…/install.sh bash quality/installer.sh
#
# Uses ports 3900 and 8090 like any install: not alongside quality/stack.sh.
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
URL_INSTALL=${QUALITY_INSTALL_URL:-https://foldrun.io/install.sh}
BASE=http://127.0.0.1:3900
DIR=$(mktemp -d "${TMPDIR:-/tmp}/foldrun-install-XXXXXX")
chmod 700 "$DIR"
MODEL=foldrun-installer-fake-model
fails=0
# A controlled environment for the installer and every Compose call: an
# exported FOLDRUN_DATA_DIR or model key from a real install must not reach
# this throwaway one (Codex review), as stack.sh does.
clean() { env -i PATH="$PATH" HOME="$HOME" ${DOCKER_HOST:+DOCKER_HOST="$DOCKER_HOST"} "$@"; }
healthy() { for _ in $(seq 1 120); do curl -fsS "$BASE/api/healthz" >/dev/null 2>&1 && return 0; sleep 2; done; return 1; }
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
cleanup() {
  [ -f "$DIR/foldrun/docker-compose.yml" ] && (cd "$DIR/foldrun" && clean docker compose down -v --remove-orphans >/dev/null 2>&1) || true
  docker rm -f "$MODEL" >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

# The installer names its Compose project "foldrun" whatever FOLDRUN_DIR is,
# so on a machine that already has an install this test would act on it —
# and its cleanup would delete that install's volume. Refuse (Codex review).
if [ -n "$(docker ps -aq --filter label=com.docker.compose.project=foldrun)" ] || docker volume ls -q | grep -q '^foldrun_'; then
  echo "installer: this machine already has a foldrun install (Compose project \"foldrun\") — run this test on a clean machine (CI does)"
  trap - EXIT; rm -rf "$DIR"; exit 2
fi

# 1. The install, as documented.
script=$(curl -fsSL "$URL_INSTALL") || { echo "FAIL could not fetch $URL_INSTALL"; exit 1; }
printf '%s' "$script" | clean FOLDRUN_DIR="$DIR/foldrun" FOLDRUN_BIND=127.0.0.1 _FOLDRUN_TTY=/dev/null sh > "$DIR/install.log" 2>&1 \
  && ok "the installer finished" || { bad "the installer failed:"; tail -20 "$DIR/install.log"; exit 1; }
healthy && ok "the platform answers /api/healthz" || bad "no health answer"
env_get() { sed -n "s/^$1=//p" "$DIR/foldrun/.env" | head -1; }
setup=$(env_get FOLDRUN_SETUP_TOKEN)
[ -n "$setup" ] && ok "the installer wrote a setup token" || bad "no FOLDRUN_SETUP_TOKEN in .env"

# 2. A fake model on the host, and the install pointed at it.
docker run -d --rm --name "$MODEL" -p 18080:8080 \
  -v "$QUALITY_DIR/fake-model/nginx.conf:/etc/nginx/nginx.conf:ro" -v "$QUALITY_DIR/fake-model/fake.js:/etc/nginx/fake.js:ro" \
  nginx:1.27-alpine >/dev/null
{ echo "ANTHROPIC_BASE_URL=http://host.docker.internal:18080/model"; echo "ANTHROPIC_API_KEY=sk-ant-quality-fake"; echo "FOLDRUN_EGRESS_ALLOW_PRIVATE=1"; } >> "$DIR/foldrun/.env"
grep -q FOLDRUN_EGRESS_ALLOW_PRIVATE "$DIR/foldrun/docker-compose.yml" || \
  printf 'services:\n  platform:\n    environment:\n      FOLDRUN_EGRESS_ALLOW_PRIVATE: "1"\n' > "$DIR/foldrun/docker-compose.override.yml"
(cd "$DIR/foldrun" && clean docker compose up -d --wait platform >/dev/null 2>&1) && healthy && ok "restarted with the model settings, and ready" || bad "restart"

# 3. The first account, by the setup link's token; a key.
jar="$DIR/cookies"
curl -fsS -c "$jar" -H "content-type: application/json" -H "origin: $BASE" \
  -d "{\"email\":\"owner@install.example.test\",\"password\":\"install-$(openssl rand -hex 10)\",\"account\":\"install\",\"setup\":\"$setup\"}" \
  "$BASE/api/auth/signup" >/dev/null && ok "the first account signs up with the setup token" || bad "signup"
token=$(curl -fsS -b "$jar" -H "content-type: application/json" -H "origin: $BASE" -d '{"label":"installer","role":"admin"}' "$BASE/api/keys" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["key"])') && ok "an API key" || bad "key"

# 4. Deploy with the published CLI, run, read the record.
docker run --rm --network host -e FOLDRUN_URL="$BASE" -e FOLDRUN_TOKEN="$token" -e NO_COLOR=1 \
  -v "$QUALITY_DIR/fixtures:/fixtures:ro" -w /fixtures "${QUALITY_NODE_IMAGE:-node:22-slim}" \
  npx -y "foldrun@${QUALITY_CLI:-latest}" deploy /fixtures/hello --to installed --yes >/dev/null \
  && ok "foldrun deploy to the fresh install" || bad "deploy"
out=$(curl -sS -H "authorization: Bearer $token" -H "content-type: application/json" -H "idempotency-key: install-$(date +%s)" \
  -X POST -d '{}' "$BASE/api/workspaces/installed/flows/hello/run?wait=true&timeout=300" -w '\n%{http_code}')
[ "${out##*$'\n'}" = 200 ] && printf '%s' "$out" | grep -q QUALITY-OK && ok "a run end to end on the fresh install" || bad "the run: ${out:0:400}"

[ "$fails" = 0 ] && echo "installer: all ok" || { echo "installer: $fails failed"; tail -30 "$DIR/install.log"; exit 1; }
