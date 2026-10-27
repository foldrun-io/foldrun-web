#!/usr/bin/env bash
# The quality stack: the open-source self-hosted install, built from this
# checkout, with a fake model — the target every quality scenario runs
# against (27 Oct 2026). Throwaway: its own Compose project and volume, no
# real account, no real model, never a real install.
#
#   bash quality/stack.sh up      # build, start, make the first account + a key
#   bash quality/stack.sh down    # stop and delete everything it made
#   bash quality/stack.sh logs
#
# Needs Docker with Compose, curl and python3; the sibling checkouts
# foldrun-core and foldrun-platform beside this one (the build context is
# their parent, as for any self-host build from source). Writes
# quality/.state/env: QUALITY_URL, QUALITY_TOKEN, QUALITY_EMAIL,
# QUALITY_PASSWORD, QUALITY_ACCOUNT.
set -euo pipefail
QUALITY_DIR=$(cd "$(dirname "$0")" && pwd)
SELF=$(cd "$QUALITY_DIR/../self-hosting" && pwd)
STATE="$QUALITY_DIR/.state"
PROJECT=${QUALITY_PROJECT:-foldrun-quality}
PORT=3900
URL="http://127.0.0.1:$PORT"
export QUALITY_DIR

# A clean environment, as install.sh runs Compose: only compose.env speaks.
# A FOLDRUN_DATA_DIR (or any FOLDRUN_*) left in the caller's shell from a
# real install would otherwise point this throwaway stack at real data
# (Codex review).
compose() {
  env -i PATH="$PATH" HOME="$HOME" ${DOCKER_HOST:+DOCKER_HOST="$DOCKER_HOST"} ${DOCKER_CONFIG:+DOCKER_CONFIG="$DOCKER_CONFIG"} \
    QUALITY_DIR="$QUALITY_DIR" ${QUALITY_MODEL_URL:+QUALITY_MODEL_URL="$QUALITY_MODEL_URL"} \
    docker compose -p "$PROJECT" --env-file "$STATE/compose.env" \
    -f "$SELF/docker-compose.yml" -f "$SELF/docker-compose.build.yml" -f "$QUALITY_DIR/compose.quality.yml" "$@"
}

up() {
  mkdir -p "$STATE"
  chmod 700 "$STATE"
  local setup secret
  setup=$(openssl rand -hex 16)
  secret=$(openssl rand -hex 32)
  cat > "$STATE/compose.env" <<ENV
FOLDRUN_SECRET_KEY=$secret
FOLDRUN_PUBLIC_URL=$URL
FOLDRUN_SETUP_TOKEN=$setup
FOLDRUN_BIND=127.0.0.1
FOLDRUN_CONCURRENCY=${QUALITY_CONCURRENCY:-4}
ENV
  chmod 600 "$STATE/compose.env"
  compose up -d --build --wait --wait-timeout 900
  for _ in $(seq 1 180); do
    curl -fsS "$URL/api/healthz" >/dev/null 2>&1 && break
    sleep 2
  done
  curl -fsS "$URL/api/healthz" >/dev/null || { echo "quality: the platform never became healthy" >&2; compose logs --tail 80 platform >&2; exit 1; }

  # The first account, the way the installer's setup link makes it.
  local email="owner@quality.example.test" password account="quality"
  password="quality-$(openssl rand -hex 12)"
  local jar="$STATE/cookies"
  rm -f "$jar"
  curl -fsS -c "$jar" -H "content-type: application/json" -H "origin: $URL" \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"account\":\"$account\",\"setup\":\"$setup\"}" \
    "$URL/api/auth/signup" >/dev/null
  # An admin key for the scenarios.
  local token
  token=$(curl -fsS -b "$jar" -H "content-type: application/json" -H "origin: $URL" \
    -d '{"label":"quality","role":"admin"}' "$URL/api/keys" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["key"])')
  cat > "$STATE/env" <<ENV
QUALITY_URL=$URL
QUALITY_TOKEN=$token
QUALITY_EMAIL=$email
QUALITY_PASSWORD=$password
QUALITY_ACCOUNT=$account
ENV
  chmod 600 "$STATE/env"
  # The workspace every suite runs against, deployed the way a user does
  # (the published CLI) — so any one suite can run on its own.
  docker run --rm --network host -e FOLDRUN_URL="$URL" -e FOLDRUN_TOKEN="$token" -e NO_COLOR=1 \
    -v "$QUALITY_DIR/fixtures:/fixtures:ro" -w /fixtures "${QUALITY_NODE_IMAGE:-node:22-slim}" \
    npx -y "foldrun@${QUALITY_CLI:-latest}" deploy /fixtures/hello --to "${QUALITY_WS:-quality-load}" --yes >/dev/null \
    || { echo "quality: deploying the fixture workspace failed" >&2; exit 1; }
  echo "quality: up at $URL (account $account; workspace ${QUALITY_WS:-quality-load}; state in quality/.state/env)"
}

down() {
  [ -f "$STATE/compose.env" ] || { echo "quality: nothing to stop"; return 0; }
  # Run containers this stack started through the socket — by the run ids
  # its own API lists, never every foldrun run on the daemon (another
  # install's must survive this; Codex review).
  if [ -f "$STATE/env" ]; then (
    # Best effort: a stack whose API is already gone still gets torn down.
    set +e +o pipefail
    # shellcheck disable=SC1091
    . "$STATE/env"
    curl -fsS -H "authorization: Bearer $QUALITY_TOKEN" "$QUALITY_URL/api/workspaces" 2>/dev/null \
      | python3 -c 'import sys,json; d=json.load(sys.stdin); print("\n".join(w["name"] for w in (d.get("workspaces", d) if isinstance(d, dict) else d)))' 2>/dev/null \
      | while read -r ws; do
          curl -fsS -H "authorization: Bearer $QUALITY_TOKEN" "$QUALITY_URL/api/workspaces/$ws/runs?limit=1000" 2>/dev/null \
            | python3 -c 'import sys,json; d=json.load(sys.stdin); print("\n".join(r["id"] for r in (d.get("runs", d) if isinstance(d, dict) else d)))' 2>/dev/null
        done | while read -r run; do
          docker ps -aq --filter "label=foldrun-run-id=$run" | xargs -r docker rm -f >/dev/null 2>&1 || true
        done
  ) || true; fi
  compose down -v --remove-orphans
  rm -rf "$STATE"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  logs) compose logs --tail "${2:-200}" ;;
  compose) shift; compose "$@" ;;
  *) echo "usage: quality/stack.sh up|down|logs|compose …" >&2; exit 2 ;;
esac
