// Self-hosting: the one-command installer (self-hosting/install.sh) and the
// two Compose files it and the guide use. The installer runs against a
// stand-in `docker` that records every call, so nothing here needs Docker;
// the Compose files are resolved with the real `docker compose config` when
// Docker is on this machine.
//
//   node --import ./tests/register.mjs --test tests/self-hosting.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HERE = path.join(import.meta.dirname, "../self-hosting");
const INSTALL = path.join(HERE, "install.sh");

interface Box {
  root: string;
  dir: string;
  log: string;
  setStable(v: string): void;
  run(env?: Record<string, string>, opts?: { noDocker?: boolean }): { status: number | null; out: string };
  env(): Record<string, string>;
  calls(): string[];
}

/** A machine with a stand-in docker and curl, and a home folder of its own. */
function box(): Box {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-install-"));
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  const raw = path.join(root, "raw");
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  fs.mkdirSync(raw);
  fs.copyFileSync(path.join(HERE, "docker-compose.yml"), path.join(raw, "docker-compose.yml"));
  const log = path.join(root, "calls.log");
  const stable = path.join(root, "stable");
  fs.writeFileSync(stable, "v2026.10.25.16");
  // Compose is run with a cleared environment; what it can see of the
  // caller's FOLDRUN_* is logged so the test can say it saw nothing.
  fs.writeFileSync(
    path.join(bin, "docker"),
    `#!/bin/sh
# compose's -f files are noted on a line of their own, so the calls read as before.
if [ "$1" = compose ] && [ "$2" = -f ]; then
  files=""; shift
  while [ "$1" = -f ]; do files="$files $2"; shift 2; done
  printf 'FILES%s\\n' "$files" >> "${log}"
  set -- compose "$@"
fi
printf '%s\\n' "$*" >> "${log}"
case "$1" in
  compose)
    # \`compose version\` only checks the plugin; every other call reads .env.
    if [ "$2" != version ]; then
      leak=$(env | grep -E '^(FOLDRUN_|ANTHROPIC_)' | cut -d= -f1 | tr '\\n' ' ')
      [ -z "$leak" ] || printf 'LEAK %s\\n' "$leak" >> "${log}"
    fi
    case "$*" in *"info --format"*) cat "${root}/platform-id" 2>/dev/null || echo daemon-1 ;; *exec*) echo 29.5.2 ;; esac
    exit 0 ;;
  info) case "$*" in *SecurityOptions*) echo '["name=seccomp"]' ;; *ID*) echo daemon-1 ;; esac; exit 0 ;;
  context) case "$*" in *remote*) echo ssh://build-server ;; *) echo unix:///var/run/docker.sock ;; esac; exit 0 ;;
  pull) exit 0 ;;
  image) cat "${stable}"; exit 0 ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  // The health probe answers as a running platform; everything else (the
  // compose download, a file:// URL) goes to the real curl.
  const realCurl = spawnSync("sh", ["-c", "command -v curl"], { encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(
    path.join(bin, "curl"),
    `#!/bin/sh
case "$*" in *api/healthz*) echo '{"ok":true,"version":"v","role":"all","workerAlive":true}'; exit 0 ;; esac
exec "${realCurl}" "$@"
`,
    { mode: 0o755 },
  );
  const dir = path.join(home, "foldrun");
  return {
    root,
    dir,
    log,
    setStable: (v) => fs.writeFileSync(stable, v),
    run(env = {}, opts = {}) {
      // No Docker: a PATH holding only curl. Nothing before the installer's
      // Docker check needs another program, and a machine's real docker
      // (CI runners have one in /usr/bin) must not be found.
      const PATH = opts.noDocker ? `${bin}-none` : `${bin}:/usr/bin:/bin`;
      if (opts.noDocker) {
        fs.mkdirSync(`${bin}-none`, { recursive: true });
        fs.copyFileSync(path.join(bin, "curl"), path.join(`${bin}-none`, "curl"));
        fs.chmodSync(path.join(`${bin}-none`, "curl"), 0o755);
      }
      const r = spawnSync("/bin/sh", [INSTALL], {
        encoding: "utf8",
        cwd: root,
        env: { NODE_ENV: "test", PATH, HOME: home, FOLDRUN_RAW: `file://${raw}`, ...env },
      });
      return { status: r.status, out: r.stdout + r.stderr };
    },
    env() {
      const out: Record<string, string> = {};
      for (const line of fs.readFileSync(path.join(dir, ".env"), "utf8").split("\n")) {
        const i = line.indexOf("=");
        if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
      }
      return out;
    },
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []),
  };
}

test("a fresh install: a new secret, this machine only, the stable version by name, then pull, up and a Docker check", () => {
  const b = box();
  const r = b.run();
  assert.equal(r.status, 0, r.out);
  const env = b.env();
  assert.match(env.FOLDRUN_SECRET_KEY, /^[0-9a-f]{64}$/);
  // The first account is tied to whoever ran this: a token in .env, and the link that carries it.
  assert.match(env.FOLDRUN_SETUP_TOKEN, /^[0-9a-f]{32}$/);
  assert.ok(r.out.includes(`/signup?setup=${env.FOLDRUN_SETUP_TOKEN}`), r.out);
  assert.equal(env.COMPOSE_PROJECT_NAME, "foldrun");
  assert.equal(env.FOLDRUN_PUBLIC_URL, "http://localhost:3900");
  assert.equal(env.FOLDRUN_BIND, "127.0.0.1");
  assert.equal(env.FOLDRUN_VERSION, "v2026.10.25.16");
  assert.equal(env.FOLDRUN_PINNED, "no");
  assert.equal(fs.statSync(path.join(b.dir, ".env")).mode & 0o777, 0o600, ".env is the owner's alone");
  assert.equal(fs.readFileSync(path.join(b.dir, "docker-compose.yml"), "utf8"), fs.readFileSync(path.join(HERE, "docker-compose.yml"), "utf8"));
  const calls = b.calls();
  assert.ok(calls.includes("pull -q ghcr.io/foldrun-io/platform:stable"), calls.join("\n"));
  assert.ok(calls.includes("compose pull runner-image") && calls.includes("compose pull platform"), "one image at a time");
  assert.ok(calls.includes("compose up -d"));
  assert.ok(calls.some((c) => c.startsWith("compose exec -T platform docker version")), "the platform's reach to Docker is proven before it says done");
  assert.ok(!calls.some((c) => c.startsWith("LEAK")), calls.join("\n"));
  assert.match(r.out, /foldrun v2026\.10\.25\.16 is running/);
  assert.match(r.out, /first account to sign up becomes the owner/);
  assert.ok(!fs.existsSync(path.join(b.dir, ".install.lock")), "the lock is released");
});

test("a re-run keeps the secret, moves to the new stable and says from what to what", () => {
  const b = box();
  assert.equal(b.run().status, 0);
  const secret = b.env().FOLDRUN_SECRET_KEY;
  b.setStable("v2026.10.27.3");
  const r = b.run({ FOLDRUN_PUBLIC_URL: "https://foldrun.example.org" });
  assert.equal(r.status, 0, r.out);
  assert.equal(b.env().FOLDRUN_SECRET_KEY, secret);
  assert.equal(b.env().FOLDRUN_VERSION, "v2026.10.27.3");
  assert.equal(b.env().FOLDRUN_PUBLIC_URL, "https://foldrun.example.org", "an explicit setting on a re-run is recorded");
  assert.equal(b.env().FOLDRUN_BIND, "127.0.0.1", "what the re-run did not mention stays");
  assert.match(r.out, /v2026\.10\.25\.16 → v2026\.10\.27\.3/);
  assert.ok(!b.calls().some((c) => c.startsWith("LEAK")), "the caller's FOLDRUN_PUBLIC_URL never reaches Compose: .env does");
});

test("a pinned version stays pinned until FOLDRUN_VERSION=stable unpins it", () => {
  const b = box();
  assert.equal(b.run({ FOLDRUN_VERSION: "v2026.10.20.4" }).status, 0);
  assert.deepEqual([b.env().FOLDRUN_VERSION, b.env().FOLDRUN_PINNED], ["v2026.10.20.4", "yes"]);
  assert.ok(!b.calls().includes("pull -q ghcr.io/foldrun-io/platform:stable"), "a pin does not ask for stable");
  b.setStable("v2026.10.27.3");
  assert.equal(b.run().status, 0);
  assert.equal(b.env().FOLDRUN_VERSION, "v2026.10.20.4");
  assert.equal(b.run({ FOLDRUN_VERSION: "stable" }).status, 0);
  assert.deepEqual([b.env().FOLDRUN_VERSION, b.env().FOLDRUN_PINNED], ["v2026.10.27.3", "no"]);
});

test("an edited docker-compose.yml is kept aside, not lost; the installer's own is replaced quietly", () => {
  const b = box();
  assert.equal(b.run().status, 0);
  const second = b.run();
  assert.equal(second.status, 0);
  assert.equal(fs.readdirSync(b.dir).filter((f) => f.endsWith(".bak")).length, 0, "unchanged: nothing kept aside");
  fs.appendFileSync(path.join(b.dir, "docker-compose.yml"), "# mine\n");
  const r = b.run();
  assert.equal(r.status, 0, r.out);
  const kept = fs.readdirSync(b.dir).filter((f) => f.endsWith(".bak"));
  assert.equal(kept.length, 1);
  assert.match(fs.readFileSync(path.join(b.dir, kept[0]), "utf8"), /# mine/);
  assert.match(r.out, /docker-compose\.override\.yml/);
});

test("it refuses clearly: no Docker, a bad address, a bad version, a .env without its key", () => {
  const b = box();
  const none = b.run({}, { noDocker: true });
  assert.notEqual(none.status, 0);
  assert.match(none.out, /Docker is not installed/);
  for (const [env, says] of [
    [{ FOLDRUN_PUBLIC_URL: "ftp://x" }, /FOLDRUN_PUBLIC_URL must be/],
    [{ FOLDRUN_PUBLIC_URL: "http://x\nFOLDRUN_SECRET_KEY=1" }, /FOLDRUN_PUBLIC_URL must be/],
    [{ FOLDRUN_VERSION: "latest" }, /FOLDRUN_VERSION must be/],
    [{ FOLDRUN_BIND: "0.0.0.0; rm -rf /" }, /FOLDRUN_BIND must be/],
    [{ FOLDRUN_BIND: "::1" }, /FOLDRUN_BIND must be an IPv4 address/],
    [{ FOLDRUN_BIND: "1.2.3" }, /FOLDRUN_BIND must be/],
    [{ ANTHROPIC_API_KEY: "sk ant" }, /ANTHROPIC_API_KEY has characters/],
  ] as const) {
    const r = b.run(env as Record<string, string>);
    assert.notEqual(r.status, 0);
    assert.match(r.out, says);
  }
  assert.ok(!fs.existsSync(path.join(b.dir, ".env")), "a refused run writes nothing");
  assert.equal(b.run().status, 0);
  fs.writeFileSync(path.join(b.dir, ".env"), "FOLDRUN_PUBLIC_URL=http://localhost:3900\n");
  const keyless = b.run();
  assert.notEqual(keyless.status, 0);
  assert.match(keyless.out, /no FOLDRUN_SECRET_KEY — restore it/);
});

test("a model key given to the installer lands in .env, and the closing note stops asking for one", () => {
  const b = box();
  const r = b.run({ ANTHROPIC_API_KEY: "sk-ant-api03-abc_DEF-123" });
  assert.equal(r.status, 0, r.out);
  assert.equal(b.env().ANTHROPIC_API_KEY, "sk-ant-api03-abc_DEF-123");
  assert.doesNotMatch(r.out, /Model key/);
});

const dockerHere = spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;

test("the compose files: images by default, pinned together, local builds with the override", { skip: !dockerHere && "no docker compose here" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-compose-"));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, `FOLDRUN_SECRET_KEY=${"a".repeat(64)}\nFOLDRUN_PUBLIC_URL=http://localhost:3900\n`);
  const config = (files: string[], extra: Record<string, string> = {}) => {
    const r = spawnSync("docker", ["compose", "--env-file", envFile, ...files.flatMap((f) => ["-f", path.join(HERE, f)]), "config", "--format", "json"], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH!, HOME: process.env.HOME!, ...extra },
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).services as Record<string, { image?: string; entrypoint?: string[]; environment?: Record<string, string>; pull_policy?: string; ports?: { host_ip?: string; published: string }[] }>;
  };
  const pulled = config(["docker-compose.yml"]);
  assert.equal(pulled.platform.image, "ghcr.io/foldrun-io/platform:stable");
  assert.equal(pulled["runner-image"].image, "ghcr.io/foldrun-io/runner:stable");
  // The runner's own entrypoint starts a step's driver; the prefetch must not.
  assert.deepEqual(pulled["runner-image"].entrypoint, ["/bin/true"]);
  assert.equal(pulled.platform.environment!.FOLDRUN_RUNNER_IMAGE, pulled["runner-image"].image, "steps run the image that was pulled");
  const pinned = config(["docker-compose.yml"], { FOLDRUN_VERSION: "v2026.10.25.16", FOLDRUN_BIND: "127.0.0.1" });
  assert.equal(pinned.platform.image, "ghcr.io/foldrun-io/platform:v2026.10.25.16");
  assert.equal(pinned.platform.environment!.FOLDRUN_RUNNER_IMAGE, "ghcr.io/foldrun-io/runner:v2026.10.25.16");
  assert.equal(pinned.platform.ports!.find((p) => p.published === "3900")!.host_ip, "127.0.0.1");
  const built = config(["docker-compose.yml", "docker-compose.build.yml"]);
  assert.equal(built.platform.image, "foldrun-self-hosted:local");
  assert.equal(built.platform.pull_policy, "never");
  assert.equal(built.platform.environment!.FOLDRUN_RUNNER_IMAGE, "", "built: core builds the step image");
  assert.equal(built["runner-image"].image, "foldrun-self-hosted:local");
  assert.deepEqual(built["runner-image"].entrypoint, ["docker-entrypoint.sh"]);
  assert.ok(built["platform-image"], "the build service is there");
});

test("a relative FOLDRUN_DIR works and leaves no lock behind, so the next run is not blocked", () => {
  const b = box();
  const first = b.run({ FOLDRUN_DIR: "./rel-foldrun" });
  assert.equal(first.status, 0, first.out);
  const second = b.run({ FOLDRUN_DIR: "./rel-foldrun" });
  assert.equal(second.status, 0, second.out);
});

test("the Compose settings given to the installer reach .env too: egress bind, data folder, socket", () => {
  const b = box();
  const dataDir = path.join(fs.realpathSync(b.root), "foldrun-data");
  const r = b.run({ FOLDRUN_EGRESS_BIND: "172.17.0.1", FOLDRUN_DATA_DIR: dataDir, FOLDRUN_DOCKER_SOCK: "/run/user/1000/docker.sock" });
  assert.equal(r.status, 0, r.out);
  assert.equal(b.env().FOLDRUN_EGRESS_BIND, "172.17.0.1");
  assert.equal(b.env().FOLDRUN_DATA_DIR, dataDir);
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700, "made private by the installer");
  assert.equal(b.env().FOLDRUN_DOCKER_SOCK, "/run/user/1000/docker.sock");
  for (const [env, says] of [
    [{ FOLDRUN_DATA_DIR: "data" }, /FOLDRUN_DATA_DIR must be an absolute path/],
    [{ FOLDRUN_DATA_DIR: "/srv/my data" }, /FOLDRUN_DATA_DIR must be/],
    [{ FOLDRUN_EGRESS_BIND: "bridge" }, /FOLDRUN_EGRESS_BIND must be/],
  ] as const) {
    const bad = b.run(env as Record<string, string>);
    assert.notEqual(bad.status, 0);
    assert.match(bad.out, says);
  }
});

// ---------- getting Docker: asked first, on a Mac and on Linux ----------
//
// A machine whose OS, user, Docker state and package managers are stand-ins.
// Docker's state is three flag files: installed (the stub is on PATH),
// running, and reachable by this user (or through sudo). Installing — by
// get.docker.com or Homebrew — puts the stub on PATH; starting sets running.
// The installer's terminal is /dev/null (_FOLDRUN_TTY), so a question reads
// as "no" unless FOLDRUN_INSTALL_DOCKER answered it, and a test run from a
// real terminal can never sit waiting at a prompt.

interface Machine {
  run(env?: Record<string, string>): { status: number | null; out: string };
  calls(): string[];
  dir: string;
  home: string;
}

function machine(o: { os: "Darwin" | "Linux"; uid?: number; docker?: boolean; running?: boolean; reachable?: boolean; brew?: boolean; colima?: boolean; systemctl?: boolean; desktop?: boolean }): Machine {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-getdocker-"));
  const bin = path.join(root, "bin");
  const stash = path.join(root, "stash");
  const st = path.join(root, "state");
  const home = path.join(root, "home");
  const raw = path.join(root, "raw");
  for (const d of [bin, stash, st, home, raw]) fs.mkdirSync(d);
  if (o.desktop) fs.mkdirSync(path.join(root, "Docker.app"));
  fs.copyFileSync(path.join(HERE, "docker-compose.yml"), path.join(raw, "docker-compose.yml"));
  const log = path.join(root, "calls.log");
  const flag = (n: string, on: boolean | undefined) => on && fs.writeFileSync(path.join(st, n), "");
  flag("running", o.running ?? true);
  flag("reachable", o.reachable ?? true);
  const sh = (name: string, body: string, where = bin) => fs.writeFileSync(path.join(where, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  // docker: needs a running daemon, and this user's reach (or sudo's).
  sh("docker", `h=""; if [ "$1" = -H ]; then h="-H $2 "; shift 2; fi
# compose's -f files are passed over, so the calls read as before.
if [ "$1" = compose ] && [ "$2" = -f ]; then shift; while [ "$1" = -f ]; do shift 2; done; set -- compose "$@"; fi
printf 'docker %s%s\\n' "$h" "$*" >> "${log}"
case "$1" in --version) exit 0 ;; context) case "$2" in inspect) echo unix:///var/run/docker.sock ;; *) echo "\${FAKE_CONTEXT:-default}" ;; esac; exit 0 ;; esac
[ -f "${st}/running" ] || { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
[ -f "${st}/reachable" ] || [ -n "$FAKE_SUDO" ] || { echo "permission denied" >&2; exit 1; }
case "$1" in
  compose) case "$*" in *"info --format"*) echo daemon-1 ;; *exec*) echo 29.5.2 ;; esac; exit 0 ;;
  info) case "$*" in *SecurityOptions*) echo '["name=seccomp"]' ;; *ID*) echo daemon-1 ;; esac; exit 0 ;;
  image) echo v2026.10.25.16; exit 0 ;;
esac
exit 0`, stash);
  if (o.docker ?? true) fs.copyFileSync(path.join(stash, "docker"), path.join(bin, "docker"));
  sh("uname", `echo ${o.os}`);
  sh("id", `case "$1" in -u) echo ${o.uid ?? 1000} ;; -un) echo ana ;; *) echo "uid=${o.uid ?? 1000}(ana)" ;; esac`);
  // The folder is this pretend user's: \`ls -ldn\` reports the stand-in uid as its owner.
  const realLs = spawnSync("sh", ["-c", "command -v ls"], { encoding: "utf8" }).stdout.trim();
  // \`ls -lde\` (macOS's ACL listing) answers "no ACL" on any host: GNU ls has no -e.
  sh("ls", `case "$1" in
  -ldn) "${realLs}" "$@" | awk -v u=${o.uid ?? 1000} '{ $3 = u; print }' ;;
  -lde) "${realLs}" -ld "$2" ;;
  *) exec "${realLs}" "$@" ;;
esac`);
  // Root survives \`env -i\` under real sudo; the stand-in's mark must too.
  sh("sudo", `printf 'sudo %s\\n' "$*" >> "${log}"; FAKE_SUDO=1; export FAKE_SUDO
if [ "$1" = env ] && [ "$2" = -i ]; then shift 2; exec env -i FAKE_SUDO=1 "$@"; fi
exec "$@"`);
  sh("usermod", `printf 'usermod %s\\n' "$*" >> "${log}"`);
  sh("open", `printf 'open %s\\n' "$*" >> "${log}"; touch "${st}/running"`);
  sh("sysctl", `case "$2" in hw.ncpu) echo 10 ;; hw.memsize) echo 34359738368 ;; esac`);
  if (o.systemctl ?? true) sh("systemctl", `printf 'systemctl %s\\n' "$*" >> "${log}"
case "$1" in is-active) [ -f "${st}/running" ] ;; start|enable) touch "${st}/running" ;; esac`);
  if (o.brew) sh("brew", `printf 'brew %s\\n' "$*" >> "${log}"
case "$1" in --prefix) echo /opt/homebrew ;; install) case "$*" in *" docker "*|*" docker") cp "${stash}/docker" "${bin}/docker" ;; esac
  case "$*" in *colima*) cp "${stash}/colima" "${bin}/colima" ;; esac ;; esac`);
  sh("colima", `printf 'colima %s\\n' "$*" >> "${log}"; case "$1" in start) touch "${st}/running" ;; esac`, stash);
  if (o.colima) fs.copyFileSync(path.join(stash, "colima"), path.join(bin, "colima"));
  // curl: get.docker.com is a script that installs docker (as root); the
  // health probe answers; the rest goes to the real curl.
  const realCurl = spawnSync("sh", ["-c", "command -v curl"], { encoding: "utf8" }).stdout.trim();
  // Only the tools the installer uses, linked one by one: a PATH with
  // /usr/bin would find this machine's real docker (CI runners have one),
  // and a "no Docker" machine would then be neither.
  const tools = path.join(root, "tools");
  fs.mkdirSync(tools);
  for (const t of ["sh", "env", "sed", "awk", "grep", "tr", "cut", "wc", "cat", "cp", "mv", "rm", "mkdir", "rmdir", "chmod", "ln", "mktemp", "cksum", "cmp", "date", "sleep", "head", "tail", "od", "openssl", "touch", "printf", "dd", "basename", "dirname", "readlink", "stat", "tee", "sort", "uniq", "xargs", "find", "ls"]) {
    const at = spawnSync("sh", ["-c", `command -v ${t}`], { encoding: "utf8" }).stdout.trim();
    if (at.startsWith("/")) fs.symlinkSync(at, path.join(tools, t));
  }
  fs.writeFileSync(path.join(stash, "get-docker.sh"), `printf 'get-docker uid=%s sudo=%s\\n' "$(id -u)" "\${FAKE_SUDO:-}" >> "${log}"\ncp "${stash}/docker" "${bin}/docker"\n`);
  sh("curl", `case "$*" in
  *get.docker.com*) printf 'curl get.docker.com\\n' >> "${log}"; for a; do [ "$prev" = -o ] && cp "${stash}/get-docker.sh" "$a"; prev=$a; done; exit 0 ;;
  *api/healthz*) echo '{"ok":true,"version":"v","role":"all","workerAlive":true}'; exit 0 ;;
esac
exec "${realCurl}" "$@"`);
  // The machine's rootful socket: there, and not writable by this user.
  const rootful = path.join(root, "docker.sock");
  spawnSync("python3", ["-c", `import socket; s=socket.socket(socket.AF_UNIX); s.bind(${JSON.stringify(rootful)})`]);
  if (fs.existsSync(rootful)) fs.chmodSync(rootful, 0o444);
  return {
    dir: path.join(home, "foldrun"),
    home,
    run(env = {}) {
      const r = spawnSync("/bin/sh", [INSTALL], {
        encoding: "utf8",
        cwd: root,
        env: { NODE_ENV: "test", PATH: `${bin}:${tools}`, HOME: home, FOLDRUN_RAW: `file://${raw}`, _FOLDRUN_ROOTFUL_SOCK: rootful, _FOLDRUN_TTY: "/dev/null", _FOLDRUN_DESKTOP_APP: path.join(root, o.desktop ? "Docker.app" : "no-Docker.app"), ...env },
      });
      return { status: r.status, out: r.stdout + r.stderr };
    },
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []),
  };
}

test("Linux, no Docker: nothing is installed without a yes — no terminal, or FOLDRUN_INSTALL_DOCKER=no", () => {
  for (const env of [{}, { FOLDRUN_INSTALL_DOCKER: "no" }] as Record<string, string>[]) {
    const m = machine({ os: "Linux", docker: false });
    const r = m.run(env);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /Docker is not installed\. Install it \(https:\/\/docs\.docker\.com\/engine\/install\/\)/);
    assert.ok(!m.calls().some((c) => c.includes("get.docker.com")), "never fetched");
  }
});

test("Linux, no Docker, a yes: Docker's own script runs as root, then foldrun installs", () => {
  const m = machine({ os: "Linux", uid: 0, docker: false, running: false });
  const r = m.run({ FOLDRUN_INSTALL_DOCKER: "yes" });
  assert.equal(r.status, 0, r.out);
  const calls = m.calls();
  assert.ok(calls.includes("curl get.docker.com"), calls.join("\n"));
  assert.ok(calls.some((c) => c.startsWith("get-docker uid=0")), "ran as root");
  assert.ok(calls.includes("systemctl enable --now docker"));
  assert.ok(calls.includes("docker compose up -d"), calls.join("\n"));
  assert.match(r.out, /Install it with Docker's official script .* — yes \(FOLDRUN_INSTALL_DOCKER=yes\)/);
});

// Root can write any socket, so "a socket this user cannot write" cannot be
// staged when the tests themselves run as root (a container, some CI).
const asRoot = typeof process.getuid === "function" && process.getuid() === 0;

test("Linux, not root: Docker's script runs through sudo, and this user is offered the docker group", { skip: asRoot && "tests running as root: no socket is out of reach" }, () => {
  const m = machine({ os: "Linux", docker: false, running: false, reachable: false });
  const r = m.run({ FOLDRUN_INSTALL_DOCKER: "yes" });
  assert.equal(r.status, 0, r.out);
  const calls = m.calls();
  assert.ok(calls.some((c) => /^get-docker uid=1000 sudo=1$/.test(c)), "through sudo");
  assert.ok(calls.includes("usermod -aG docker ana"), "the group, asked first");
  // Through sudo, every call pinned to the socket that was verified, not root's own context.
  const sock = calls.find((c) => c.startsWith("sudo docker -H unix://"))?.split(" ")[3];
  assert.ok(sock && sock.endsWith("docker.sock"), calls.join("\n"));
  assert.ok(calls.includes(`sudo docker -H ${sock} pull -q ghcr.io/foldrun-io/platform:stable`) && calls.includes(`sudo docker -H ${sock} compose -f docker-compose.yml up -d`), "this run reaches Docker through sudo, at the verified socket");
  assert.ok(!calls.some((c) => /^sudo docker (?!-H )/.test(c)), "no sudo docker call without the socket");
  // Under sudo, Compose never gets this user's PATH or HOME (their plugins would run as root).
  assert.ok(!calls.some((c) => c.startsWith("sudo env -i")), calls.join("\n"));
  // Docker's script was staged in a private folder in the home, then removed.
  assert.ok(calls.some((c) => /^sudo sh .*\/home\/\.foldrun-get-docker\.[^/]+\/get-docker\.sh$/.test(c)), calls.join("\n"));
  assert.ok(!fs.readdirSync(m.home).some((f) => f.startsWith(".foldrun-get-docker.")), "the staging folder is gone");
  assert.match(r.out, /root-equivalent/);
});

test("Linux, Docker stopped: started with systemctl after a yes; refused without one", () => {
  const yes = machine({ os: "Linux", uid: 0, running: false });
  const ran = yes.run({ FOLDRUN_INSTALL_DOCKER: "yes" });
  assert.equal(ran.status, 0, ran.out);
  assert.ok(yes.calls().includes("systemctl start docker"));
  const no = machine({ os: "Linux", uid: 0, running: false });
  const r = no.run({ FOLDRUN_INSTALL_DOCKER: "no" });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /Docker is not running\. Start it/);
  assert.ok(!no.calls().includes("systemctl start docker"));
});

test("Mac, no Docker, Homebrew, a yes: colima + docker + docker-compose, the plugin linked, a VM sized for heavy", () => {
  const m = machine({ os: "Darwin", docker: false, running: false, brew: true });
  const r = m.run({ FOLDRUN_INSTALL_DOCKER: "yes" });
  assert.equal(r.status, 0, r.out);
  const calls = m.calls();
  assert.ok(calls.includes("brew install colima docker docker-compose"), calls.join("\n"));
  // 10 cores and 32 GiB here: 4 cores, 8 GiB — a heavy step's, not more.
  assert.ok(calls.includes("colima start --cpu 4 --memory 8"), calls.join("\n"));
  assert.equal(fs.readlinkSync(path.join(m.home, ".docker/cli-plugins/docker-compose")), "/opt/homebrew/opt/docker-compose/bin/docker-compose");
  assert.ok(calls.includes("docker compose up -d"));
});

test("Mac, no Docker, no Homebrew: says how, installs nothing", () => {
  const m = machine({ os: "Darwin", docker: false });
  const r = m.run({ FOLDRUN_INSTALL_DOCKER: "yes" });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /install Homebrew \(https:\/\/brew\.sh\)/);
  assert.match(r.out, /Docker Desktop/);
});

test("Mac, a stopped Docker Desktop context is never swapped for Colima", () => {
  const m = machine({ os: "Darwin", running: false, colima: true });
  const r = m.run({ FOLDRUN_INSTALL_DOCKER: "yes", FAKE_CONTEXT: "desktop-linux" });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /not answering at the endpoint this user has chosen/);
  assert.ok(!m.calls().some((c) => c.startsWith("colima start")), m.calls().join("\n"));
});

test("Mac, a stopped Colima profile is started as that profile", () => {
  const m = machine({ os: "Darwin", running: false, colima: true });
  const r = m.run({ FOLDRUN_INSTALL_DOCKER: "yes", FAKE_CONTEXT: "colima-work" });
  assert.equal(r.status, 0, r.out);
  assert.ok(m.calls().includes("colima start --profile work --cpu 4 --memory 8"), m.calls().join("\n"));
});

test("Mac, Colima installed but stopped: started after a yes", () => {
  const m = machine({ os: "Darwin", running: false, colima: true });
  const r = m.run({ FOLDRUN_INSTALL_DOCKER: "yes" });
  assert.equal(r.status, 0, r.out);
  assert.ok(m.calls().includes("colima start --cpu 4 --memory 8"), m.calls().join("\n"));
});

test("Linux, a chosen Docker that is down (DOCKER_HOST, a context, rootless): no group, no sudo, no system service, a clear error", () => {
  for (const [env, running] of [
    [{ DOCKER_HOST: "ssh://build-server" }, true], [{ DOCKER_CONTEXT: "rootless" }, true], [{ _FOLDRUN_ROOTFUL_SOCK: "/nonexistent.sock" }, true],
    // the system service stopped too: still not started for someone else's Docker
    [{ DOCKER_HOST: "unix:///run/user/1000/docker.sock" }, false], [{ FAKE_CONTEXT: "rootless" }, false],
  ] as const) {
    const m = machine({ os: "Linux", reachable: false, running });
    const r = m.run({ FOLDRUN_INSTALL_DOCKER: "yes", ...env });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /not answering at the endpoint this user has chosen/);
    assert.ok(!m.calls().some((c) => c.startsWith("usermod") || c.startsWith("sudo") || c === "systemctl start docker"), m.calls().join("\n"));
  }
});

test("Mac, Docker Desktop installed and stopped: opened after a yes (default or desktop-linux context)", () => {
  for (const ctx of ["default", "desktop-linux"]) {
    const m = machine({ os: "Darwin", running: false, colima: true, desktop: true });
    const r = m.run({ FOLDRUN_INSTALL_DOCKER: "yes", FAKE_CONTEXT: ctx });
    assert.equal(r.status, 0, r.out);
    assert.ok(m.calls().includes("open -a Docker"), m.calls().join("\n"));
    assert.ok(!m.calls().some((c) => c.startsWith("colima start")), "Desktop's, not Colima");
  }
});

test("Mac, the Compose plugin is linked where DOCKER_CONFIG says", () => {
  const m = machine({ os: "Darwin", docker: false, running: false, brew: true });
  const cfg = path.join(m.home, "dockercfg");
  assert.equal(m.run({ FOLDRUN_INSTALL_DOCKER: "yes", DOCKER_CONFIG: cfg }).status, 0);
  assert.ok(fs.existsSync(path.join(cfg, "cli-plugins/docker-compose")) || fs.lstatSync(path.join(cfg, "cli-plugins/docker-compose")).isSymbolicLink());
});

test("a folder another user can write to is refused before anything is written or run", () => {
  const b = box();
  fs.mkdirSync(b.dir, { recursive: true });
  fs.chmodSync(b.dir, 0o777);
  const r = b.run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /can be written by other users — run: chmod go-w/);
  assert.ok(!fs.existsSync(path.join(b.dir, ".env")), "nothing written");
  assert.ok(!b.calls().some((c) => /^compose (pull|up)/.test(c)), "nothing pulled or started");
});

test("a planted .compose.new symlink is removed, never written through", () => {
  const b = box();
  fs.mkdirSync(b.dir, { recursive: true, mode: 0o700 });
  const victim = path.join(b.root, "victim.txt");
  fs.writeFileSync(victim, "keep me");
  fs.symlinkSync(victim, path.join(b.dir, ".compose.new"));
  assert.equal(b.run().status, 0);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep me");
});

test("Compose is always given the downloaded file (and the override), never a compose.yaml or COMPOSE_FILE beside it", () => {
  const b = box();
  assert.equal(b.run().status, 0);
  const files = b.calls().filter((c) => c.startsWith("FILES"));
  assert.ok(files.length > 0 && files.every((f) => f === "FILES docker-compose.yml"), files.join("\n"));
  fs.writeFileSync(path.join(b.dir, "docker-compose.override.yml"), "services: {}\n");
  fs.writeFileSync(path.join(b.dir, "compose.yaml"), "services: {evil: {image: x}}\n");
  assert.equal(b.run().status, 0);
  const after = b.calls().filter((c) => c.startsWith("FILES")).slice(files.length);
  assert.ok(after.length > 0 && after.every((f) => f === "FILES docker-compose.yml docker-compose.override.yml"), after.join("\n"));
});

test("a platform that reaches a different Docker from the one it was installed into is refused", () => {
  const b = box();
  fs.writeFileSync(path.join(b.root, "platform-id"), "daemon-2"); // the Compose environment is cleared; a file reaches the stand-in
  const r = b.run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /(would reach|reaches) a different Docker/);
});

test("the folder check: owned by this user, no group/other write, no ACL", () => {
  // Not this user's: the stand-in uid is not the folder's owner.
  const m = machine({ os: "Linux", uid: 0 });
  const realLs = spawnSync("sh", ["-c", "command -v ls"], { encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(path.join(path.dirname(m.dir), "..", "bin", "ls"), `#!/bin/sh\nif [ "$1" = -ldn ]; then "${realLs}" "$@" | awk '{ $3 = 4242; print }'; else exec "${realLs}" "$@"; fi\n`, { mode: 0o755 });
  const r = m.run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /is not owned by you/);
});

test("an override or .env that others can write, or a symlinked one, is refused — Compose runs what they say", () => {
  for (const [file, how, says] of [
    ["docker-compose.override.yml", "mode", /docker-compose\.override\.yml can be written by other users/],
    [".env", "mode", /\.env can be written by other users/],
    ["docker-compose.override.yml", "link", /docker-compose\.override\.yml is a symlink/],
    [".compose.installed", "link", /\.compose\.installed is a symlink/],
    ["docker-compose.yml", "link", /docker-compose\.yml is a symlink/],
  ] as const) {
    const b = box();
    assert.equal(b.run().status, 0);
    const at = path.join(b.dir, file);
    if (how === "mode") {
      if (!fs.existsSync(at)) fs.writeFileSync(at, "services: {}\n");
      fs.chmodSync(at, 0o666);
    } else {
      fs.writeFileSync(path.join(b.root, "elsewhere.yml"), "services: {}\n");
      fs.rmSync(at, { force: true });
      fs.symlinkSync(path.join(b.root, "elsewhere.yml"), at);
    }
    const r = b.run();
    assert.notEqual(r.status, 0, file);
    assert.match(r.out, says);
  }
});

test("the platform's Docker identity is required, not optional: an unreadable one stops the install", () => {
  const b = box();
  fs.writeFileSync(path.join(b.root, "platform-id"), "");
  const r = b.run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /(would reach|reaches) a different Docker/);
});

test("an ACL on the folder is refused — read from ls -le on a Mac, where -l shows @ and hides it", { skip: process.platform !== "darwin" && "macOS ACLs" }, () => {
  const b = box();
  fs.mkdirSync(b.dir, { recursive: true, mode: 0o700 });
  spawnSync("xattr", ["-w", "com.example.probe", "1", b.dir]);
  spawnSync("chmod", ["+a", "everyone allow add_file,delete_child", b.dir]);
  const r = b.run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /has an access control list/);
  spawnSync("chmod", ["-N", b.dir]);
  assert.equal(b.run().status, 0, "cleared, it installs");
});

test("FOLDRUN_RAW must be https or a local folder: plain http could swap the file that decides what Docker runs", () => {
  const b = box();
  const r = b.run({ FOLDRUN_RAW: "http://mirror.example/self-hosting" });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /FOLDRUN_RAW must be an https:\/\/ address/);
});

test("an override that brings in other files (include:, extends: file:) is refused", () => {
  for (const yml of [
    "include:\n  - /srv/shared.yml\n",
    "services:\n  platform:\n    extends:\n      file: /srv/shared.yml\n      service: x\n",
    '"include": [../shared/compose.yml]\n',
    "services: {platform: {extends: {file: ../shared/platform.yml, service: platform}}}\n",
  ]) {
    const b = box();
    assert.equal(b.run().status, 0);
    fs.writeFileSync(path.join(b.dir, "docker-compose.override.yml"), yml, { mode: 0o600 });
    const r = b.run();
    assert.notEqual(r.status, 0);
    assert.match(r.out, /brings in other files/);
  }
});

test("a wrong Docker is caught before the platform starts", () => {
  const b = box();
  fs.writeFileSync(path.join(b.root, "platform-id"), "daemon-2");
  const r = b.run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /would reach a different Docker/);
  assert.ok(!b.calls().some((c) => c.startsWith("compose up")), "never started");
});

test("an install folder whose parent another user could rename entries in is refused", () => {
  const b = box();
  const shared = path.join(b.root, "shared");
  fs.mkdirSync(shared, { mode: 0o777 });
  fs.chmodSync(shared, 0o777); // world-writable, not sticky: anyone could swap foldrun/ for their own
  const r = b.run({ FOLDRUN_DIR: path.join(shared, "foldrun") });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /can be written by other users, so Docker could be pointed at files other than this install's/);
  assert.ok(!b.calls().some((c) => /^compose (pull|up)/.test(c)), "nothing pulled or started");
});

test("a deny-only ACL (a Mac home has one) is not a grant: the install goes ahead", { skip: process.platform !== "darwin" && "macOS ACLs" }, () => {
  const b = box();
  fs.mkdirSync(b.dir, { recursive: true, mode: 0o700 });
  spawnSync("chmod", ["+a", "group:everyone deny delete", b.dir]);
  const r = b.run();
  assert.equal(r.status, 0, r.out);
});

test("a sticky parent that group and others can write (/tmp's 1777) is accepted: only an entry's owner may rename it", () => {
  const b = box();
  const tmpLike = path.join(b.root, "tmp-like");
  fs.mkdirSync(tmpLike);
  fs.chmodSync(tmpLike, 0o1777);
  const r = b.run({ FOLDRUN_DIR: path.join(tmpLike, "foldrun") });
  assert.equal(r.status, 0, r.out);
});

test("with a plain-http network address the setup link is for localhost, never sent across the network", () => {
  const b = box();
  const r = b.run({ FOLDRUN_BIND: "0.0.0.0", FOLDRUN_PUBLIC_URL: "http://192.168.1.20:3900" });
  assert.equal(r.status, 0, r.out);
  const token = b.env().FOLDRUN_SETUP_TOKEN;
  assert.ok(r.out.includes(`http://localhost:3900/signup?setup=${token}`), r.out);
  assert.ok(!r.out.includes(`http://192.168.1.20:3900/signup?setup=`), "the token is never in a plain-http network link");
  assert.match(r.out, /ssh -L 3900:localhost:3900/);
});

test("bound to one network address, the setup link goes through a tunnel to that address", () => {
  const b = box();
  const r = b.run({ FOLDRUN_BIND: "192.168.1.20", FOLDRUN_PUBLIC_URL: "http://192.168.1.20:3900" });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /ssh -L 3900:192\.168\.1\.20:3900/);
  assert.ok(!r.out.includes("http://192.168.1.20:3900/signup?setup="));
});

test("a read-granting ACL on the install folder is refused: .env holds the keys", { skip: process.platform !== "darwin" && "macOS ACLs" }, () => {
  const b = box();
  fs.mkdirSync(b.dir, { recursive: true, mode: 0o700 });
  spawnSync("chmod", ["+a", "everyone allow read,list,file_inherit", b.dir]);
  const r = b.run();
  assert.notEqual(r.status, 0);
  assert.match(r.out, /access control list that gives another user access/);
  assert.ok(!fs.existsSync(path.join(b.dir, ".env")), "no secret written");
});

test("an install folder reached through a symlink is checked, and used, by its real path", () => {
  const b = box();
  const real = path.join(b.root, "real-place");
  fs.mkdirSync(real, { mode: 0o700 });
  const link = path.join(b.root, "via-link");
  fs.symlinkSync(real, link);
  const r = b.run({ FOLDRUN_DIR: link });
  assert.equal(r.status, 0, r.out);
  assert.ok(r.out.includes(fs.realpathSync(real)), "messages name the real path");
  assert.ok(fs.existsSync(path.join(real, ".env")));
});

test("an override that only mentions the words (a comment, a path) is fine", () => {
  const b = box();
  assert.equal(b.run().status, 0);
  fs.writeFileSync(path.join(b.dir, "docker-compose.override.yml"), "# no include here, nothing extends\nservices:\n  platform:\n    volumes:\n      - /srv/includes:/data/includes:ro\n", { mode: 0o600 });
  const r = b.run();
  assert.equal(r.status, 0, r.out);
});

test("FOLDRUN_DATA_DIR: a folder of your own is used; one others can write is refused before anything starts", () => {
  const ok = box();
  const mine = path.join(ok.root, "data-mine");
  fs.mkdirSync(mine, { mode: 0o700 });
  assert.equal(ok.run({ FOLDRUN_DATA_DIR: mine }).status, 0);
  const bad = box();
  const shared = path.join(bad.root, "data-shared");
  fs.mkdirSync(shared);
  fs.chmodSync(shared, 0o777);
  const r = bad.run({ FOLDRUN_DATA_DIR: shared });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /is open to other users \(mode drwxrwxrwx\)/);
  assert.ok(!bad.calls().some((c) => /^compose (pull|up)/.test(c)), "nothing started");
});

test("an override that names env files is refused, in every form: settings go in .env or environment:", () => {
  for (const yml of [
    "services:\n  platform:\n    env_file: /srv/shared/platform.env\n",
    "services:\n  platform:\n    env_file: [app.env]\n",
    "services:\n  platform:\n    env_file:\n      - path: safe.env\n        required: true\n      - path: shared/other.env\n",
    "services: {platform: {env_file: app.env}}\n",
  ]) {
    const b = box();
    assert.equal(b.run().status, 0);
    fs.writeFileSync(path.join(b.dir, "docker-compose.override.yml"), yml, { mode: 0o600 });
    const r = b.run();
    assert.notEqual(r.status, 0, yml);
    assert.match(r.out, /uses env_file — put those settings in/);
  }
});

test("FOLDRUN_DATA_DIR: a missing folder is made private; a symlinked one is kept by its real path; a remote Docker is refused", () => {
  const b = box();
  const made = path.join(fs.realpathSync(b.root), "new", "data");
  assert.equal(b.run({ FOLDRUN_DATA_DIR: made }).status, 0);
  assert.equal(fs.statSync(made).mode & 0o777, 0o700);
  const c = box();
  const real = path.join(fs.realpathSync(c.root), "real-data");
  fs.mkdirSync(real, { mode: 0o700 });
  const link = path.join(fs.realpathSync(c.root), "data-link");
  fs.symlinkSync(real, link);
  assert.equal(c.run({ FOLDRUN_DATA_DIR: link }).status, 0);
  assert.equal(c.env().FOLDRUN_DATA_DIR, real, "the folder checked is the folder mounted");
  const d = box();
  const r = d.run({ FOLDRUN_DATA_DIR: path.join(fs.realpathSync(d.root), "data"), DOCKER_HOST: "ssh://build-server" });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /Docker here is remote/);
});

test("a remote DOCKER_CONTEXT wins over a local DOCKER_HOST, as in Docker: a host data folder is refused", () => {
  const b = box();
  const r = b.run({ FOLDRUN_DATA_DIR: path.join(fs.realpathSync(b.root), "data"), DOCKER_HOST: "unix:///var/run/docker.sock", DOCKER_CONTEXT: "remote" });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /Docker here is remote/);
});

test("a new data folder under a symlinked parent is checked by the parent's real path", () => {
  const b = box();
  const realParent = path.join(fs.realpathSync(b.root), "real-parent");
  fs.mkdirSync(realParent, { mode: 0o700 });
  const linkParent = path.join(fs.realpathSync(b.root), "link-parent");
  fs.symlinkSync(realParent, linkParent);
  const r = b.run({ FOLDRUN_DATA_DIR: path.join(linkParent, "data") });
  assert.equal(r.status, 0, r.out);
  assert.equal(b.env().FOLDRUN_DATA_DIR, path.join(realParent, "data"));
});
