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
# What it does: checks Docker — and, asked first, installs or starts it
# (Colima with Homebrew on a Mac, get.docker.com on Linux) — puts
# docker-compose.yml in ~/foldrun, writes
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
#   FOLDRUN_INSTALL_DOCKER  yes: install or start Docker without asking (for
#                        a script with no terminal); no: never offer to
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
# Where the compose file comes from: https, or a local file:// folder (a
# mirror, the tests). Never plain http — the file decides what Docker runs.
case $FOLDRUN_RAW in https://?*|file:///?*) ;; *) printf '\nfoldrun install: FOLDRUN_RAW must be an https:// address or a file:/// folder, not %s\n' "$FOLDRUN_RAW" >&2; exit 1 ;; esac
IMAGES=ghcr.io/foldrun-io

say() { printf '%s\n' "$*"; }
die() { printf '\nfoldrun install: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# docker compose with only .env speaking: nothing in the caller's shell
# overrides a value the file holds (Compose lets the shell win otherwise).
dc() {
  # The files named, always: the one this script downloaded and checked,
  # and the documented override. Without -f, Compose would prefer a
  # compose.yaml in the folder, or a COMPOSE_FILE in .env, over it.
  if [ -f docker-compose.override.yml ]; then
    set -- -f docker-compose.yml -f docker-compose.override.yml "$@"
  else
    set -- -f docker-compose.yml "$@"
  fi
  # Through sudo (a user just given the docker group, this run only), plain:
  # sudo's own safe PATH and root's home, never this user's PATH, HOME or
  # Compose plugins — those would run as root. sudo clears the environment
  # itself, so .env still speaks alone.
  if [ -n "$SUDO" ]; then sudo docker -H "unix://$ROOTFUL_SOCK" compose "$@"; return; fi
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
  chmod 600 "$tmp"
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

# An ACL that GRANTS someone write to $1 — not merely any ACL: a Mac home
# folder carries `group:everyone deny delete`, which takes access away.
# Asked for directly where the system can say: macOS's `ls -le` lists the
# entries (its `ls -l` shows `@` instead of `+` when the path also has
# extended attributes); Linux's getfacl -s lists only extended entries. With
# neither, GNU ls's `+` (an ACL) or `?` (could not tell) counts as a grant.
# An inspection that fails is not a clean bill. ($2: the mode string.)
# Any ACL entry that GRANTS (allow, or a named Linux user/group entry) on
# $1 — for the install folder and its files, where even read would expose
# .env (the secret key, a model key, the setup token) whatever the mode
# bits say. Deny-only entries take access away and pass. ($2: the mode.)
has_grant_acl() {
  if [ "$(os_name)" = Darwin ]; then
    out=$(ls -lde "$1" 2>/dev/null) || die "could not read the access control list of $1 (ls -le)"
    printf '%s\n' "$out" | sed -n '2,$p' | grep -q ' allow '
  elif have getfacl; then
    out=$(getfacl -s -c "$1" 2>/dev/null) || die "could not read the access control list of $1 (getfacl)"
    printf '%s\n' "$out" | grep -Eq '^(default:)?(user|group):[^:]+:'
  else
    case $2 in ??????????[+?]*) return 0 ;; esac
    return 1
  fi
}

has_acl() {
  if [ "$(os_name)" = Darwin ]; then
    out=$(ls -lde "$1" 2>/dev/null) || die "could not read the access control list of $1 (ls -le)"
    printf '%s\n' "$out" | sed -n '2,$p' | grep ' allow ' \
      | grep -Eq 'write|append|add_file|add_subdirectory|delete_child|delete|chown'
  elif have getfacl; then
    out=$(getfacl -s -c "$1" 2>/dev/null) || die "could not read the access control list of $1 (getfacl)"
    # A named user or group with w (default: entries included); the bare
    # user::/group::/other:: and mask:: lines grant nothing of their own.
    printf '%s\n' "$out" | grep -Eq '^(default:)?(user|group):[^:]+:[^:]*w'
  else
    case $2 in ??????????[+?]*) return 0 ;; esac
    return 1
  fi
}

# Every folder from $1 up to /: owned by this user or root, and writable by
# nobody else (a sticky /tmp-style folder excepted) — anyone who could rename
# an entry in one of them could swap the path for their own between a check
# and its use. $2: what is at stake, for the message.
safe_ancestry() {
  p=$1
  while :; do
    line=$(ls -ldn "$p") || die "could not read the owner and mode of $p"
    m=$(printf '%s\n' "$line" | awk '{ print $1 }'); o=$(printf '%s\n' "$line" | awk '{ print $3 }')
    { [ "$o" = 0 ] || [ "$o" = "$(id -u)" ]; } || die "$p belongs to another user, so $2"
    # Group or other write lets someone rename entries — unless the folder
    # is sticky (t/T), like /tmp, where only an entry's owner may.
    case $m in ?????????[tT]*) ;; ?????w*|????????w*) die "$p can be written by other users, so $2" ;; esac
    ! has_acl "$p" "$m" || die "$p has an access control list that lets another user write to it, so $2"
    [ "$p" = / ] && break
    p=$(dirname "$p")
  done
}

# The host data folder (FOLDRUN_DATA_DIR): accounts, their password hashes
# and the vault live there, so it is private by construction. Made here,
# owner-only, when it does not exist; when it does, owned by this user or
# root with no group or other access at all, no ACL granting any, and safe
# parents. Its real path (symlinks resolved) is what .env keeps, so the
# folder checked is the folder Docker mounts. Echoes that path.
data_folder() {
  d=$1
  if [ ! -e "$d" ] && [ ! -L "$d" ]; then
    p=$(dirname "$d")
    while [ ! -e "$p" ]; do p=$(dirname "$p"); done
    p=$(cd "$p" && pwd -P) || die "could not open $p"
    safe_ancestry "$p" "$2"
    # Made private here; if someone else made it first, the owner check below says so.
    (umask 077 && mkdir -p "$d") || die "could not make $d"
  fi
  real=$(cd "$d" 2>/dev/null && pwd -P) || die "$d is not a folder foldrun can open"
  line=$(ls -ldn "$real") || die "could not read the owner and mode of $real"
  m=$(printf '%s\n' "$line" | awk '{ print $1 }'); o=$(printf '%s\n' "$line" | awk '{ print $3 }')
  { [ "$o" = 0 ] || [ "$o" = "$(id -u)" ]; } || die "$real belongs to another user — $2"
  case $m in d???------*) ;; *) die "$real is open to other users (mode ${m%%[+@.]*}) — run: chmod 700 $real, then this again; $2" ;; esac
  ! has_grant_acl "$real" "$m" || die "$real has an access control list that gives another user access — $2"
  safe_ancestry "$(dirname "$real")" "$2"
  printf '%s\n' "$real"
}

# Whether the Docker in use is on this machine (a unix socket). A host data
# folder is checked here and mounted by the daemon: a remote one would mount
# a folder of the same name on another machine, unchecked.
docker_is_local() {
  # Docker's own order: DOCKER_CONTEXT, then DOCKER_HOST, then the current context.
  if [ -n "${DOCKER_CONTEXT:-}" ]; then
    ep=$(dk context inspect "$DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}' 2>/dev/null) || return 1
  elif [ -n "${DOCKER_HOST:-}" ]; then
    ep=$DOCKER_HOST
  else
    ep=$(dk context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)
  fi
  case $ep in ''|unix://*) return 0 ;; *) return 1 ;; esac
}

# A path Compose reads (the folder, .env, an override) is this user's alone:
# owned by them, writable by nobody else, no ACL, and — for a file — not a
# symlink to somewhere else. Docker runs what these say, with root's reach.
trusted() {
  [ ! -L "$1" ] || die "$dir/$1 is a symlink — Compose would read whatever it points at; replace it with a file of your own"
  line=$(ls -ldn "$1") || die "could not read the owner and mode of $dir/$1"
  perms=$(printf '%s\n' "$line" | awk '{ print $1, $3 }')
  [ "${perms#* }" = "$(id -u)" ] || die "$dir/$1 is not owned by you — use a folder and files of your own (FOLDRUN_DIR)"
  case ${perms%% *} in ?????w*|????????w*) die "$dir/$1 can be written by other users — run: chmod go-w $dir/$1, then this again" ;; esac
  ! has_grant_acl "$1" "${perms%% *}" || die "$dir/$1 has an access control list that gives another user access — remove it (macOS: chmod -N; Linux: setfacl -b), then run this again"
}

# ---------------------------------------------------------------- Docker
#
# Docker missing, stopped, or out of this user's reach: say what is needed
# and, asked first, do it — Colima through Homebrew on a Mac, Docker's own
# get.docker.com script on Linux. The answer is read from the terminal
# (`curl … | sh` gives this script's stdin to the download), and with no
# terminal nothing is installed unless FOLDRUN_INSTALL_DOCKER=yes said so in
# advance; FOLDRUN_INSTALL_DOCKER=no never asks.

# `sudo` when this run must reach Docker through it (a user just added to
# the docker group has the group only from their next login).
SUDO=
# The socket a sudo run was verified against (local_rootful_socket): every
# sudo Docker call names it, so root's own Docker configuration (a context
# of its own) cannot point this run at a different daemon.
ROOTFUL_SOCK=
dk() { if [ -n "$SUDO" ]; then sudo docker -H "unix://$ROOTFUL_SOCK" "$@"; else docker "$@"; fi; }

os_name() { if have uname; then uname -s; else echo unknown; fi; }

# A question with a yes/no answer from the person at the terminal.
confirm() {
  case ${FOLDRUN_INSTALL_DOCKER:-} in
    yes) say "$1 — yes (FOLDRUN_INSTALL_DOCKER=yes)"; return 0 ;;
    no) return 1 ;;
  esac
  tty=${_FOLDRUN_TTY:-/dev/tty} # the tests point this at /dev/null: no terminal, no answer
  (: <"$tty") 2>/dev/null || return 1
  printf '%s [y/N] ' "$1" > "$tty"
  read -r answer < "$tty" || return 1
  case $answer in y|Y|yes|Yes|YES) return 0 ;; *) return 1 ;; esac
}

# Root runs it as is; anyone else through sudo, which asks its own password.
as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"
  elif have sudo; then sudo "$@"
  else die "this needs root: run it as root, or install sudo"; fi
}

# Up to a minute for a daemon that was just started to answer.
wait_for_docker() {
  n=0
  until dk info >/dev/null 2>&1; do
    n=$((n + 1)); [ "$n" -lt 30 ] || return 1; sleep 2
  done
}

# The cores and memory a Mac's Colima VM gets: enough for a heavy step
# (4 cores, 8 GiB) where the Mac has it, never more than half its memory.
colima_size() {
  cpus=$(sysctl -n hw.ncpu 2>/dev/null || echo 2)
  mem=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 4294967296) / 1073741824 / 2 ))
  [ "$cpus" -le 4 ] || cpus=4
  [ "$mem" -ge 2 ] || mem=2
  [ "$mem" -le 8 ] || mem=8
}

# Docker's Compose plugin from Homebrew, where `docker compose` finds it.
# This user's Docker CLI plugin folder, when it exists: `docker compose` runs
# what it holds, so it and every folder above it (physically, no symlinks)
# must be this user's or root's to change — checked before any Compose call.
check_plugin_dir() {
  plugins="${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins"
  [ -d "$plugins" ] || return 0
  plugins=$(cd "$plugins" && pwd -P) || die "could not open $plugins"
  safe_ancestry "$plugins" "Docker's CLI plugins there are not safe to run — fix that folder's permissions, then run this again"
}

link_compose_plugin() {
  plugins="${DOCKER_CONFIG:-$HOME/.docker}/cli-plugins"
  mkdir -p "$plugins"
  plugins=$(cd "$plugins" && pwd -P) || die "could not open $plugins"
  # `docker compose` runs what this folder holds: it, and every folder above
  # it, must be this user's (or root's) to change.
  safe_ancestry "$plugins" "the Compose plugin cannot be linked there safely — fix that folder's permissions, then run this again"
  ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" "$plugins/docker-compose"
}

mac_docker() {
  if ! have docker; then
    have brew || die "Docker is not installed. On a Mac, install Homebrew (https://brew.sh) and run this again, which offers Colima — or install Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/)."
    colima_size
    confirm "Docker is not installed. Install it with Homebrew — colima (a small Linux VM, $cpus CPUs, ${mem} GiB), docker and docker-compose — and start it?" \
      || die "Docker is not installed. Install it (brew install colima docker docker-compose && colima start, or Docker Desktop), then run this again."
    brew install colima docker docker-compose || die "brew install colima docker docker-compose failed"
    link_compose_plugin
    colima start --cpu "$cpus" --memory "$mem" || die "colima start failed — see: colima status"
  fi
  if ! dk info >/dev/null 2>&1; then
    # Start only the Docker this user has chosen: its context says which.
    [ -z "${DOCKER_HOST:-}" ] || die "$CHOSEN_DOWN"
    ctx=$(docker_context)
    desktop=; [ -d "${_FOLDRUN_DESKTOP_APP:-/Applications/Docker.app}" ] && desktop=yes # the tests point this elsewhere
    case $ctx in
      colima|colima-*)
        have colima || die "$CHOSEN_DOWN"
        profile=${ctx#colima}; profile=${profile#-}
        colima_size
        confirm "Docker is installed but not running. Start Colima${profile:+ (profile $profile)} ($cpus CPUs, ${mem} GiB)?" || die "Docker is not running. Start it (colima start${profile:+ --profile $profile}), then run this again."
        colima start ${profile:+--profile "$profile"} --cpu "$cpus" --memory "$mem" || die "colima start failed — see: colima status" ;;
      desktop-linux)
        [ -n "$desktop" ] || die "$CHOSEN_DOWN"
        confirm "Docker Desktop is installed but not running. Open it?" || die "Docker is not running. Open Docker Desktop, then run this again."
        open -a Docker || die "could not open Docker Desktop" ;;
      default)
        # The default socket is Docker Desktop's when it is installed;
        # without it nothing serves that socket, so no install lives there
        # and Colima may take over.
        if [ -n "$desktop" ]; then
          confirm "Docker Desktop is installed but not running. Open it?" || die "Docker is not running. Open Docker Desktop, then run this again."
          open -a Docker || die "could not open Docker Desktop"
        elif have colima; then
          colima_size
          confirm "Docker is installed but not running. Start Colima ($cpus CPUs, ${mem} GiB)?" || die "Docker is not running. Start it (colima start), then run this again."
          colima start --cpu "$cpus" --memory "$mem" || die "colima start failed — see: colima status"
        fi ;;
      *) die "$CHOSEN_DOWN" ;;
    esac
    wait_for_docker || die "Docker is installed but not answering. Start Docker (colima start, or open Docker Desktop), then run this again."
  fi
  if ! dk compose version >/dev/null 2>&1 && have brew; then
    confirm "The Docker Compose plugin is missing. Install it with Homebrew (docker-compose)?" || die "The Docker Compose plugin is missing. Install it (brew install docker-compose), then run this again."
    brew install docker-compose || die "brew install docker-compose failed"
    link_compose_plugin
  fi
}

# The Docker context this user has chosen: DOCKER_CONTEXT, else the CLI's
# current one. An installation lives in one daemon, and starting another
# (Colima's, the system's) would put an update into a second, empty one.
docker_context() {
  if [ -n "${DOCKER_CONTEXT:-}" ]; then echo "$DOCKER_CONTEXT"; return; fi
  ctx=$(docker context show 2>/dev/null) || ctx=default
  echo "${ctx:-default}"
}
CHOSEN_DOWN="Docker is not answering at the endpoint this user has chosen (DOCKER_HOST, a docker context, or FOLDRUN_DOCKER_SOCK). Start that Docker, then run this again."

# This user's Docker is the machine's own rootful daemon, refused for want
# of the docker group: no DOCKER_HOST, the default context, no socket of
# their own, and /var/run/docker.sock there but not writable by them.
local_rootful_socket() {
  [ -z "${DOCKER_HOST:-}" ] && [ -z "${FOLDRUN_DOCKER_SOCK:-}" ] || return 1
  case ${DOCKER_CONTEXT:-default} in default) ;; *) return 1 ;; esac
  [ "$(docker_context)" = default ] || return 1
  sock=${_FOLDRUN_ROOTFUL_SOCK:-/var/run/docker.sock} # the tests point this elsewhere
  [ -S "$sock" ] && [ ! -w "$sock" ]
}

linux_docker() {
  if ! have docker; then
    confirm "Docker is not installed. Install it with Docker's official script (https://get.docker.com: the engine and the Compose plugin; it runs as root)?" \
      || die "Docker is not installed. Install it (https://docs.docker.com/engine/install/), then run this again."
    # Staged in a private folder in this user's home, not $TMPDIR: root runs
    # it, and a shared TMPDIR without the sticky bit would let another user
    # swap the file while sudo waits for a password.
    # …and $HOME and its parent writable by nobody else: someone who can
    # rename entries in either could swap the folder while sudo waits.
    safe_ancestry "$HOME" "Docker's install script cannot be staged safely under $HOME — install Docker yourself (https://docs.docker.com/engine/install/), then run this again"
    stage=$(mktemp -d "$HOME/.foldrun-get-docker.XXXXXX") || die "could not make a folder in $HOME"
    chmod 700 "$stage"
    curl -fsSL --retry 3 https://get.docker.com -o "$stage/get-docker.sh" || { rm -rf "$stage"; die "could not download https://get.docker.com"; }
    # Its input closed: apt and its restart check read the terminal, and
    # would take the answer meant for the next question (found on Ubuntu 24.04).
    as_root sh "$stage/get-docker.sh" </dev/null || { rm -rf "$stage"; die "Docker's install script failed — see its output above"; }
    rm -rf "$stage"
    if have systemctl; then as_root systemctl enable --now docker >/dev/null 2>&1 || true; fi
  fi
  if ! docker info >/dev/null 2>&1; then
    # A Docker of the user's own choosing (remote, rootless, another
    # context) is theirs to start; the system service is not it.
    { [ -z "${DOCKER_HOST:-}" ] && [ -z "${FOLDRUN_DOCKER_SOCK:-}" ] && [ "$(docker_context)" = default ]; } || die "$CHOSEN_DOWN"
    # Not running: offer to start it (no root needed to ask systemd).
    if have systemctl && ! systemctl is-active --quiet docker 2>/dev/null; then
      confirm "Docker is installed but not running. Start it (systemctl start docker)?" \
        || die "Docker is not running. Start it (sudo systemctl start docker), then run this again."
      as_root systemctl start docker || die "systemctl start docker failed — see: systemctl status docker"
      sleep 2
    fi
    # Running, but not for this user: offer the docker group — only when
    # the Docker this user points at IS the machine's rootful daemon. A
    # rootless, remote or other-context daemon that is down is not a
    # permission problem, and switching to sudo would install into a
    # different Docker (a second, empty foldrun) instead of this one.
    if ! docker info >/dev/null 2>&1; then
      local_rootful_socket \
        || die "$CHOSEN_DOWN"
      { [ "$(id -u)" != 0 ] && have sudo; } \
        || die "Docker is installed but not reachable by this user. Start Docker. On Linux either run this as a user in the docker group (https://docs.docker.com/engine/install/linux-postinstall/ — that group is root-equivalent) or use rootless Docker."
      me=$(id -un)
      confirm "Docker runs, but $me cannot reach it. Add $me to the docker group? (That group is root-equivalent; it takes effect at your next login, and this run uses sudo until then.)" \
        || die "Docker is not reachable by this user. Run this as a user in the docker group (https://docs.docker.com/engine/install/linux-postinstall/ — that group is root-equivalent), as root, or with rootless Docker."
      sudo usermod -aG docker "$me" || die "could not add $me to the docker group"
      SUDO=sudo
      ROOTFUL_SOCK=${_FOLDRUN_ROOTFUL_SOCK:-/var/run/docker.sock}
    fi
    wait_for_docker || die "Docker is not answering — see: systemctl status docker"
  fi
}

ensure_docker() {
  check_plugin_dir
  case $(os_name) in
    Darwin) mac_docker ;;
    Linux) linux_docker ;;
    *)
      have docker || die "Docker is not installed. Install it (https://docs.docker.com/get-docker/), then run this again."
      docker info >/dev/null 2>&1 || die "Docker is installed but not reachable by this user. Start Docker, then run this again." ;;
  esac
  have docker || die "Docker is not installed. Install it (https://docs.docker.com/get-docker/), then run this again."
  dk info >/dev/null 2>&1 || die "Docker is installed but not reachable by this user. Start Docker, then run this again."
  dk compose version >/dev/null 2>&1 || die "The Docker Compose plugin is missing (the 'docker compose' command). Install it: https://docs.docker.com/compose/install/"
}

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
  ensure_docker

  umask 077
  mkdir -p "$dir"
  cd "$dir"
  # Absolute and physical from here (pwd -P: no symlink in the path), so
  # what is checked below is what Compose later opens; the cleanup runs
  # from inside it.
  dir=$(pwd -P)
  cd "$dir"
  # Yours alone. Compose runs what this folder holds with Docker's reach
  # (root's, in effect), so a folder another user owns or can write to
  # could have a file or a symlink planted in it before this run.
  # The folder and every file Compose reads from it: owned by this user
  # (`id -u`, nothing the folder can influence), writable by nobody else,
  # no ACL (it can grant write the mode bits do not show), no symlinks.
  trusted .
  safe_ancestry "$(dirname "$dir")" "Docker could be pointed at files other than this install's — install into a folder whose parents only you and root can change (FOLDRUN_DIR), then run this again"
  # …and every file it writes: none may be a symlink planted to make this
  # run write through it to somewhere else.
  for f in .env docker-compose.override.yml docker-compose.yml .compose.installed; do
    if [ -e "$f" ] || [ -L "$f" ]; then trusted "$f"; fi
  done
  # The override must stand alone: an `include:` or `extends:` key — block
  # or flow style, quoted or not — would bring in Compose files these checks
  # never looked at. The words elsewhere (a comment, a path) are fine. Data
  # it names — a secret's or an env file — is this user's own configuration.
  if [ -f docker-compose.override.yml ] && grep -Eq '(^|[{,])[[:space:]]*["'"'"']?(include|extends)["'"'"']?[[:space:]]*:' docker-compose.override.yml; then
    die "$dir/docker-compose.override.yml brings in other files (include: or extends: file:) — put those settings in the override itself, or run docker compose by hand"
  fi
  # (These match Compose's keys as people write them. Only this file's
  # owner can write it, so a key spelled to slip past — a YAML escape, an
  # explicit `? key` — is that person's own choice of what to load.)
  # Env files are refused there: their contents reach the platform's
  # environment (NODE_OPTIONS can run code), and every YAML form of naming
  # one cannot be checked safely here. Settings go in .env, or in the
  # override's own environment:, both of which the checks above cover.
  if [ -f docker-compose.override.yml ] && grep -Eq '(^|[{,])[[:space:]]*["'"'"']?env_file["'"'"']?[[:space:]]*:' docker-compose.override.yml; then
    die "$dir/docker-compose.override.yml uses env_file — put those settings in $dir/.env or in the override's own environment:, then run this again"
  fi
  mkdir .install.lock 2>/dev/null || die "another install is running in $dir (if not, remove $dir/.install.lock)"
  trap 'rm -f "$dir"/.env.?????? "$dir"/.compose.new; rmdir "$dir/.install.lock" 2>/dev/null || true' EXIT
  trap 'exit 130' INT TERM

  # The compose file: replaced when it is the one this script put there,
  # kept aside when someone edited it (their changes belong in
  # docker-compose.override.yml, which Compose reads too).
  say "foldrun: fetching docker-compose.yml"
  rm -f .compose.new # never written through: a leftover (or a planted symlink) goes first
  curl -fsSL --retry 3 "$FOLDRUN_RAW/docker-compose.yml" -o .compose.new || die "could not download $FOLDRUN_RAW/docker-compose.yml"
  chmod 600 .compose.new # caps any permission an inherited ACL would add
  grep -q "$IMAGES/platform" .compose.new || die "the downloaded docker-compose.yml is not foldrun's"
  if [ -f docker-compose.yml ] && ! cmp -s docker-compose.yml .compose.new; then
    if [ "$(fingerprint docker-compose.yml)" != "$(cat .compose.installed 2>/dev/null || true)" ]; then
      keep="docker-compose.yml.$(date +%Y%m%d%H%M%S).bak"
      # A name nothing occupies: a planted file or symlink there would make
      # this copy write through it.
      if [ -e "$keep" ] || [ -L "$keep" ]; then die "$dir/$keep already exists — move it aside and run this again"; fi
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
    if [ -z "$want_sock" ] && dk info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then
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
  # The first account becomes the owner, and every local user can reach
  # localhost: the setup token ties that first signup to whoever ran this.
  # Written once (an install from before it gets one), printed in the link.
  if [ -z "$(get_env FOLDRUN_SETUP_TOKEN)" ]; then
    if have openssl; then setup=$(openssl rand -hex 16); else setup=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n'); fi
    case $setup in ????????????????????????????????) ;; *) die "could not make a setup token" ;; esac
    set_env FOLDRUN_SETUP_TOKEN "$setup"
  fi
  [ -z "$want_key" ] || set_env ANTHROPIC_API_KEY "$want_key"
  [ -z "$want_egress" ] || set_env FOLDRUN_EGRESS_BIND "$want_egress"
  [ -z "$want_data" ] || set_env FOLDRUN_DATA_DIR "$want_data"
  # The data folder in effect (given now, or kept in .env from before).
  data_dir=$(get_env FOLDRUN_DATA_DIR)
  if [ -n "$data_dir" ]; then
    docker_is_local || die "FOLDRUN_DATA_DIR is a folder on this machine, but Docker here is remote (DOCKER_HOST or a docker context) — it would mount a folder of that name on the other machine, unchecked. Use the default data volume, or run the installer on the Docker host"
    real_data=$(data_folder "$data_dir" "foldrun's data (accounts, the vault) would be open to another user; use a folder of your own (FOLDRUN_DATA_DIR)") || exit 1
    [ "$real_data" = "$data_dir" ] || set_env FOLDRUN_DATA_DIR "$real_data"
  fi
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
    dk pull -q "$IMAGES/platform:stable" >/dev/null || die "could not pull $IMAGES/platform:stable"
    version=$(dk image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$IMAGES/platform:stable")
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
  # The Docker the platform will be given must be this one — checked
  # before it starts (a one-off container with the platform's own mounts),
  # so a wrong socket never gets to run anything.
  here=$(dk info --format '{{.ID}}' 2>/dev/null || true)
  [ -n "$here" ] || die "could not read this Docker's identity (docker info) to check the platform reaches the same one — run this again"
  there=$(dc run --rm --no-deps -T --entrypoint docker platform info --format '{{.ID}}' 2>/dev/null | tr -d '\r' || true)
  [ "$here" = "$there" ] \
    || die "the platform would reach a different Docker through ${sock:-/var/run/docker.sock} from the one foldrun is installed into — set FOLDRUN_DOCKER_SOCK in $dir/.env to this Docker's own socket, and run this again"
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
  # The same Docker, not just a Docker: the platform starts every step
  # through the socket it was given, and one that reaches another daemon
  # (a rootless socket under a rootful install) would run steps elsewhere.
  there=$(dc exec -T platform docker info --format '{{.ID}}' 2>/dev/null | tr -d '\r' || true)
  [ "$here" = "$there" ] \
    || { dc stop platform >/dev/null 2>&1 || true; die "the platform reaches a different Docker through ${sock:-/var/run/docker.sock} from the one foldrun was installed into, so it was stopped — set FOLDRUN_DOCKER_SOCK in $dir/.env to this Docker's own socket, and run this again"; }

  say ""
  say "foldrun $version is running."
  say ""
  # The setup token travels in the link: over https, or on this machine
  # (localhost) — never across a network in plain http, where anyone on the
  # path could read it and create the owner account first.
  # Bound to one address (not loopback, not all): the port is only there,
  # so the tunnel goes to it.
  # 127.0.0.1, never "localhost": the port is published on IPv4 only, and a
  # browser that tries IPv6 (::1) first could reach another user's listener
  # there — and hand it the token.
  case $bind in 127.0.0.1|0.0.0.0) here_addr=127.0.0.1 ;; *) here_addr=$bind ;; esac
  case $url in
    https://*) setup_url="$url/signup?setup=$(get_env FOLDRUN_SETUP_TOKEN)" ;;
    *) setup_url="http://127.0.0.1:3900/signup?setup=$(get_env FOLDRUN_SETUP_TOKEN)" ;;
  esac
  say "  Open        $setup_url"
  case $url in
    https://*|http://localhost*|http://127.0.0.1*) ;;
    *) say "              (on this machine, or from yours through: ssh -L 127.0.0.1:3900:$here_addr:3900 <this server>, then open it there — not over plain http)" ;;
  esac
  say "              — the first account to sign up becomes the owner, and only this link can create it"
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
