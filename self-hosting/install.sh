#!/bin/sh
# foldrun, self-hosted, in one command:
#
#   curl -fsSL https://foldrun.io/install.sh | sh
#
# Read it first if you like (you should, for anything piped into a shell):
#
#   curl -fsSL https://foldrun.io/install.sh -o install.sh
#   less install.sh && sh install.sh
#
# What it does: checks Docker, puts docker-compose.yml in ~/foldrun, writes
# .env there once (a fresh secret key, the address, the version), pulls the
# ready-made images (amd64 or arm64) and starts foldrun. Run it again to
# update: .env is kept, the version moves to the newest stable unless you
# pinned one. It never deletes your data.
#
# Settings, all optional, as environment variables:
#
#   FOLDRUN_DIR          where it lives                 (default ~/foldrun)
#   FOLDRUN_PUBLIC_URL   the address people open        (default http://localhost:3900)
#   FOLDRUN_BIND         the address the dashboard listens on (default 127.0.0.1,
#                        this machine only; 0.0.0.0 opens it to the network —
#                        sign up at once then: the first account is the owner)
#   FOLDRUN_VERSION      pin a version, vYYYY.MM.DD.N  (default: stable, which
#                        a re-run moves forward); FOLDRUN_VERSION=stable unpins
#   ANTHROPIC_API_KEY    the model key steps run on    (or each account's own,
#                        in Settings → Model)
#   FOLDRUN_EGRESS_BIND  where the egress proxy (8090) listens (default 0.0.0.0;
#                        on a server facing a network, the Docker bridge, 172.17.0.1)
#   FOLDRUN_DATA_DIR     a host folder for the data      (default: a Docker volume)
#   FOLDRUN_DOCKER_SOCK  the Docker socket               (default /var/run/docker.sock;
#                        rootless Docker is found)
#
# Each one given is written to .env, on a first install or an update.
#
#   curl -fsSL https://foldrun.io/install.sh | FOLDRUN_BIND=0.0.0.0 \
#     FOLDRUN_PUBLIC_URL=http://192.168.1.20:3900 sh
#
# Source: https://github.com/foldrun-io/foldrun-web/tree/main/self-hosting
# Licence: FSL-1.1-ALv2 — free for your own and your organisation's use.
#
# Everything runs inside main(), called on the last line, so a download cut
# short runs nothing at all.

set -eu

FOLDRUN_RAW=${FOLDRUN_RAW:-https://raw.githubusercontent.com/foldrun-io/foldrun-web/main/self-hosting}
IMAGES=ghcr.io/foldrun-io

say() { printf '%s\n' "$*"; }
die() { printf '\nfoldrun install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# docker compose with only .env speaking: nothing in the caller's shell
# overrides a value the file holds (Compose lets the shell win otherwise).
dc() {
  env -i PATH="$PATH" HOME="$HOME" \
    ${DOCKER_HOST:+DOCKER_HOST="$DOCKER_HOST"} \
    ${DOCKER_CONTEXT:+DOCKER_CONTEXT="$DOCKER_CONTEXT"} \
    ${DOCKER_CONFIG:+DOCKER_CONFIG="$DOCKER_CONFIG"} \
    ${DOCKER_TLS:+DOCKER_TLS="$DOCKER_TLS"} \
    ${DOCKER_TLS_VERIFY:+DOCKER_TLS_VERIFY="$DOCKER_TLS_VERIFY"} \
    ${DOCKER_CERT_PATH:+DOCKER_CERT_PATH="$DOCKER_CERT_PATH"} \
    ${DOCKER_API_VERSION:+DOCKER_API_VERSION="$DOCKER_API_VERSION"} \
    ${XDG_RUNTIME_DIR:+XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR"} \
    docker compose "$@"
}

get_env() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n 1 || true; }

# Rewrites .env through a temporary file: an interrupted run never leaves it
# half written. Values are checked before they get here and never sourced.
set_env() {
  tmp=$(mktemp ".env.XXXXXX")
  if [ -f .env ]; then grep -v "^$1=" .env > "$tmp" || true; fi
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  mv "$tmp" .env
}

valid_url() {
  case $1 in http://?*|https://?*) ;; *) return 1 ;; esac
  case $1 in *[!A-Za-z0-9._~:/?@%+=,\[\]-]*) return 1 ;; esac
}
# IPv4 only: Compose's "address:port:port" and the health probe below take it as is.
valid_bind() {
  case $1 in ''|*[!0-9.]*|.*|*.|*..*) return 1 ;; esac
  [ "$(printf '%s' "$1" | tr -cd . | wc -c | tr -d ' ')" = 3 ]
}
valid_version() {
  [ "$1" = stable ] && return 0
  case $1 in v[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9].[0-9]*) ;; *) return 1 ;; esac
  case ${1#v????.??.??.} in ''|*[!0-9]*) return 1 ;; esac
}
valid_key() { case $1 in ''|*[!A-Za-z0-9_-]*) return 1 ;; esac; }
valid_path() { case $1 in /*) ;; *) return 1 ;; esac; case $1 in *[!A-Za-z0-9._/-]*) return 1 ;; esac; }

fingerprint() { cksum < "$1" | awk '{ print $1 "-" $2 }'; }

main() {
  # What the caller asked for, read once; .env is the record from here on.
  dir=${FOLDRUN_DIR:-$HOME/foldrun}
  want_url=${FOLDRUN_PUBLIC_URL:-}
  want_bind=${FOLDRUN_BIND:-}
  want_version=${FOLDRUN_VERSION:-}
  want_key=${ANTHROPIC_API_KEY:-}
  want_egress=${FOLDRUN_EGRESS_BIND:-}
  want_data=${FOLDRUN_DATA_DIR:-}
  want_sock=${FOLDRUN_DOCKER_SOCK:-}
  [ -z "$want_url" ] || valid_url "$want_url" || die "FOLDRUN_PUBLIC_URL must be an http:// or https:// address, plain characters only: $want_url"
  [ -z "$want_bind" ] || valid_bind "$want_bind" || die "FOLDRUN_BIND must be an IPv4 address (127.0.0.1, 0.0.0.0, …): $want_bind"
  [ -z "$want_version" ] || valid_version "$want_version" || die "FOLDRUN_VERSION must be vYYYY.MM.DD.N or stable: $want_version"
  [ -z "$want_key" ] || valid_key "$want_key" || die "ANTHROPIC_API_KEY has characters a key does not"
  [ -z "$want_egress" ] || valid_bind "$want_egress" || die "FOLDRUN_EGRESS_BIND must be an IPv4 address (172.17.0.1, …): $want_egress"
  [ -z "$want_data" ] || valid_path "$want_data" || die "FOLDRUN_DATA_DIR must be an absolute path, plain characters only: $want_data"
  [ -z "$want_sock" ] || valid_path "$want_sock" || die "FOLDRUN_DOCKER_SOCK must be an absolute path: $want_sock"

  say "foldrun: checking Docker"
  have curl || die "curl is needed."
  have docker || die "Docker is not installed. Install it (https://docs.docker.com/get-docker/), then run this again."
  docker info >/dev/null 2>&1 || die "Docker is installed but not reachable by this user. Start Docker. On Linux either run this as a user in the docker group (https://docs.docker.com/engine/install/linux-postinstall/ — that group is root-equivalent) or use rootless Docker."
  docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is missing (the 'docker compose' command). Install it: https://docs.docker.com/compose/install/"

  umask 077
  mkdir -p "$dir"
  cd "$dir"
  # Absolute from here: the cleanup below runs from inside it.
  dir=$(pwd)
  mkdir .install.lock 2>/dev/null || die "another install is running in $dir (if not, remove $dir/.install.lock)"
  trap 'rm -f "$dir"/.env.?????? "$dir"/.compose.new; rmdir "$dir/.install.lock" 2>/dev/null || true' EXIT
  trap 'exit 130' INT TERM

  # The compose file: replaced when it is the one this script put there,
  # kept aside when someone edited it (their changes belong in
  # docker-compose.override.yml, which Compose reads too).
  say "foldrun: fetching docker-compose.yml"
  curl -fsSL --retry 3 "$FOLDRUN_RAW/docker-compose.yml" -o .compose.new || die "could not download $FOLDRUN_RAW/docker-compose.yml"
  grep -q "$IMAGES/platform" .compose.new || die "the downloaded docker-compose.yml is not foldrun's"
  if [ -f docker-compose.yml ] && ! cmp -s docker-compose.yml .compose.new; then
    if [ "$(fingerprint docker-compose.yml)" != "$(cat .compose.installed 2>/dev/null || true)" ]; then
      keep="docker-compose.yml.$(date +%Y%m%d%H%M%S).bak"
      cp docker-compose.yml "$keep"
      say "foldrun: docker-compose.yml had your own changes — kept as $keep (put changes in docker-compose.override.yml)"
    fi
  fi
  mv .compose.new docker-compose.yml
  fingerprint docker-compose.yml > .compose.installed

  if [ ! -f .env ]; then
    say "foldrun: a new install in $dir"
    if have openssl; then secret=$(openssl rand -hex 32); else secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n'); fi
    case $secret in ????????????????????????????????????????????????????????????????) ;; *) die "could not make a secret key" ;; esac
    set_env FOLDRUN_SECRET_KEY "$secret"
    # The volume's name no longer depends on the folder's.
    set_env COMPOSE_PROJECT_NAME foldrun
    set_env FOLDRUN_PUBLIC_URL "${want_url:-http://localhost:3900}"
    set_env FOLDRUN_BIND "${want_bind:-127.0.0.1}"
    # Rootless Docker keeps its socket under the user's runtime directory.
    if [ -z "$want_sock" ] && docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then
      sock="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock"
      [ -S "$sock" ] || die "rootless Docker, but no socket at $sock — set FOLDRUN_DOCKER_SOCK in $dir/.env and run this again"
      set_env FOLDRUN_DOCKER_SOCK "$sock"
    fi
  else
    say "foldrun: updating the install in $dir (.env kept)"
    # Only what this run was explicitly given changes.
    [ -z "$want_url" ] || set_env FOLDRUN_PUBLIC_URL "$want_url"
    [ -z "$want_bind" ] || set_env FOLDRUN_BIND "$want_bind"
  fi
  [ -z "$want_key" ] || set_env ANTHROPIC_API_KEY "$want_key"
  [ -z "$want_egress" ] || set_env FOLDRUN_EGRESS_BIND "$want_egress"
  [ -z "$want_data" ] || set_env FOLDRUN_DATA_DIR "$want_data"
  [ -z "$want_sock" ] || set_env FOLDRUN_DOCKER_SOCK "$want_sock"
  [ -n "$(get_env FOLDRUN_SECRET_KEY)" ] || die "$dir/.env has no FOLDRUN_SECRET_KEY — restore it from your backup (a new one would sign everyone out and void every webhook)"

  # The version: a pin stays a pin; otherwise the newest stable, resolved to
  # its real name so .env says what is running.
  old=$(get_env FOLDRUN_VERSION)
  if [ -n "$want_version" ] && [ "$want_version" != stable ]; then
    version=$want_version
    set_env FOLDRUN_PINNED yes
  elif [ -z "$want_version" ] && [ "$(get_env FOLDRUN_PINNED)" = yes ] && [ -n "$old" ]; then
    version=$old
  else
    say "foldrun: finding the current stable version"
    docker pull -q "$IMAGES/platform:stable" >/dev/null || die "could not pull $IMAGES/platform:stable"
    version=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$IMAGES/platform:stable")
    valid_version "$version" && [ "$version" != stable ] || die "the stable image carries no version ($version)"
    set_env FOLDRUN_PINNED no
  fi
  set_env FOLDRUN_VERSION "$version"
  if [ -n "$old" ] && [ "$old" != "$version" ]; then say "foldrun: $old → $version"; fi

  # One image at a time: Compose pulls in parallel, and two pulls sharing a
  # layer can trip containerd ("failed commit on ref … rename … no such file",
  # seen on 26 Oct 2026). Each is retried, since a pull resumes where it left.
  say "foldrun: pulling $version (the step image is a few GB the first time)"
  for service in runner-image platform; do
    n=0
    until dc pull "$service"; do
      n=$((n + 1))
      [ "$n" -lt 3 ] || die "could not pull the $service image for $version"
      say "foldrun: the pull stopped; trying again ($n/2)"
      sleep 5
    done
  done
  say "foldrun: starting"
  dc up -d || die "docker compose up failed — see: cd $dir && docker compose logs"

  bind=$(get_env FOLDRUN_BIND); bind=${bind:-0.0.0.0}
  case $bind in 0.0.0.0|'') probe=127.0.0.1 ;; *) probe=$bind ;; esac
  url=$(get_env FOLDRUN_PUBLIC_URL)
  say "foldrun: waiting for it to answer"
  tries=0
  until curl -fsS --max-time 5 "http://$probe:3900/api/healthz" 2>/dev/null | grep -q '"workerAlive":true'; do
    tries=$((tries + 1))
    [ "$tries" -lt 60 ] || die "it did not come up in 3 minutes — see: cd $dir && docker compose logs platform"
    sleep 3
  done
  # Steps start as sibling containers through the socket: prove the platform
  # reaches the daemon now, not on the first run.
  sock=$(get_env FOLDRUN_DOCKER_SOCK)
  dc exec -T platform docker version --format '{{.Server.Version}}' >/dev/null 2>&1 \
    || die "the platform cannot reach Docker through ${sock:-/var/run/docker.sock} — set FOLDRUN_DOCKER_SOCK in $dir/.env to this machine's Docker socket and run this again"

  say ""
  say "foldrun $version is running."
  say ""
  say "  Open        $url/signup   — the first account to sign up becomes the owner"
  if [ "$bind" = 127.0.0.1 ]; then
    say "              (this machine only; to open it to the network run the installer again with FOLDRUN_BIND=0.0.0.0)"
  fi
  [ -n "$(get_env ANTHROPIC_API_KEY)" ] || say "  Model key   add ANTHROPIC_API_KEY=… to $dir/.env, then: cd $dir && docker compose up -d   (or per account, in Settings → Model)"
  say "  CLI         npm i -g foldrun && foldrun login --url $url"
  say "  Update      run this installer again"
  say "  Stop        cd $dir && docker compose stop"
  project=$(get_env COMPOSE_PROJECT_NAME)
  say "  Back up     $dir/.env (the secret key) and the ${project:-$(basename "$dir")}_foldrun-data volume"
}

main "$@"
