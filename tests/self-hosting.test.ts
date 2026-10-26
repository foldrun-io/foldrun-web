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
printf '%s\\n' "$*" >> "${log}"
case "$1" in
  compose)
    # \`compose version\` only checks the plugin; every other call reads .env.
    if [ "$2" != version ]; then
      leak=$(env | grep -E '^(FOLDRUN_|ANTHROPIC_)' | cut -d= -f1 | tr '\\n' ' ')
      [ -z "$leak" ] || printf 'LEAK %s\\n' "$leak" >> "${log}"
    fi
    case "$2" in exec) echo 29.5.2 ;; esac
    exit 0 ;;
  info) case "$*" in *SecurityOptions*) echo '["name=seccomp"]' ;; esac; exit 0 ;;
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
  const r = b.run({ FOLDRUN_EGRESS_BIND: "172.17.0.1", FOLDRUN_DATA_DIR: "/srv/foldrun-data", FOLDRUN_DOCKER_SOCK: "/run/user/1000/docker.sock" });
  assert.equal(r.status, 0, r.out);
  assert.equal(b.env().FOLDRUN_EGRESS_BIND, "172.17.0.1");
  assert.equal(b.env().FOLDRUN_DATA_DIR, "/srv/foldrun-data");
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
