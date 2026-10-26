// /api/version, /api/changelog, the X-Foldrun-Version header, and where
// the answer comes from: the deploy's release.json, else the environment
// the rollout set, else "dev".
//
//   node --import ./tests/register.mjs --test tests/version.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-version-"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-release-"));
const file = path.join(dir, "release.json");
process.env.FOLDRUN_RELEASE_FILE = file;
delete process.env.FOLDRUN_VERSION;
delete process.env.FOLDRUN_BUILD;
delete process.env.FOLDRUN_RUNNER_ENGINES;

const { NextRequest } = await import("next/server");
const release = await import("../server/release.ts");
const { GET: versionGET } = await import("../app/api/version/route.ts");
const { GET: changelogGET } = await import("../app/api/changelog/route.ts");
const { proxy } = await import("../proxy.ts");

const record = {
  version: "v2026.10.01.3",
  released_at: "2026-10-01T05:00:00Z",
  build: "aaaaaaa.bbbbbbb.ccccccc.ddddddd.eeeeeee",
  components: { core: "aaaaaaa", platform: "bbbbbbb", web: "ccccccc", docs: "ddddddd", infra: "eeeeeee", cli: "fffffff" },
  packages: { core: "0.4.3", cli: "0.7.0" },
  releases: Array.from({ length: 12 }, (_, i) => ({
    version: `v2026.10.01.${12 - i}`,
    released_at: null,
    previous: i < 11 ? `v2026.10.01.${11 - i}` : null,
    components: {},
    notes: { features: [{ repo: "web", sha: "ccccccc", subject: "what's new page" }], fixes: [], docs: [], other: [] },
  })),
};

function write(r: unknown) {
  fs.writeFileSync(file, JSON.stringify(r));
  // A new mtime, so the cache re-reads even within the same millisecond.
  const t = new Date(Date.now() + Math.random() * 10_000);
  fs.utimesSync(file, t, t);
  release._resetReleaseCache();
}

test("no file, no environment: dev, with core's package version and no shas", () => {
  fs.rmSync(file, { force: true });
  release._resetReleaseCache();
  const v = release.versionInfo();
  assert.equal(v.version, "dev");
  assert.equal(v.api, release.API_VERSION);
  assert.equal(v.released_at, null);
  assert.equal(v.components.core, null);
  assert.match(v.packages.core ?? "", /^\d+\.\d+\.\d+/);
  assert.deepEqual(release.releases(), []);
});

test("environment only: FOLDRUN_VERSION names it, FOLDRUN_BUILD gives the five shas", () => {
  process.env.FOLDRUN_VERSION = "v2026.10.01.9";
  process.env.FOLDRUN_BUILD = "1111111.2222222.3333333.4444444.5555555";
  try {
    const v = release.versionInfo();
    assert.equal(v.version, "v2026.10.01.9");
    assert.deepEqual(
      { core: v.components.core, platform: v.components.platform, web: v.components.web, docs: v.components.docs, infra: v.components.infra, cli: v.components.cli },
      { core: "1111111", platform: "2222222", web: "3333333", docs: "4444444", infra: "5555555", cli: null },
    );
  } finally {
    delete process.env.FOLDRUN_VERSION;
    delete process.env.FOLDRUN_BUILD;
  }
});

test("a hosted build's sixth sha is foldrun-admin's; five or six parts, nothing else", () => {
  assert.equal(release.componentsOfBuild("1111111.2222222.3333333.4444444.5555555.6666666").admin, "6666666");
  assert.equal(release.componentsOfBuild("1111111.2222222.3333333.4444444.5555555").admin, null, "a public build has no admin part");
  assert.equal(release.componentsOfBuild("1111111.2222222.3333333.4444444.5555555").infra, "5555555");
  assert.equal(release.componentsOfBuild("1111111.2222222.3333333.4444444.5555555.6666666.7777777").core, null, "seven parts is not a build");
  assert.equal(release.componentsOfBuild("1111111.2222222.3333333.4444444").core, null, "four is not either");
});

test("the deploy's file: version, date, components, packages", async () => {
  write(record);
  const res = await versionGET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.version, "v2026.10.01.3");
  assert.equal(body.released_at, "2026-10-01T05:00:00Z");
  assert.equal(body.api, release.API_VERSION);
  assert.equal(body.components.cli, "fffffff");
  assert.deepEqual(body.packages, { core: "0.4.3", cli: "0.7.0" });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("a file for another version than the rollout set is not believed about shas or date", () => {
  write(record);
  process.env.FOLDRUN_VERSION = "v2026.10.02.1";
  try {
    const v = release.versionInfo();
    assert.equal(v.version, "v2026.10.02.1");
    assert.equal(v.released_at, null);
    assert.equal(v.components.web, null);
    assert.equal(v.packages.cli, null);
  } finally {
    delete process.env.FOLDRUN_VERSION;
  }
});

test("a broken file reads as no file, never a 500", async () => {
  fs.writeFileSync(file, "{ not json");
  release._resetReleaseCache();
  const res = await versionGET();
  assert.equal(res.status, 200);
  assert.equal((await res.json()).version, "dev");
});

test("/api/changelog: refused without a key, newest first and capped with one", async () => {
  write(record);
  const saved = process.env.FOLDRUN_DEV_NO_AUTH;
  delete process.env.FOLDRUN_DEV_NO_AUTH;
  try {
    const refused = await changelogGET(new NextRequest("http://x/api/changelog"));
    assert.equal(refused.status, 401);
  } finally {
    if (saved !== undefined) process.env.FOLDRUN_DEV_NO_AUTH = saved;
  }
  process.env.FOLDRUN_DEV_NO_AUTH = "1";
  try {
    const def = await (await changelogGET(new NextRequest("http://x/api/changelog"))).json();
    assert.equal(def.version, "v2026.10.01.3");
    assert.equal(def.releases.length, 10);
    assert.equal(def.releases[0].version, "v2026.10.01.12");
    const three = await (await changelogGET(new NextRequest("http://x/api/changelog?limit=3"))).json();
    assert.equal(three.releases.length, 3);
    const silly = await (await changelogGET(new NextRequest("http://x/api/changelog?limit=nope"))).json();
    assert.equal(silly.releases.length, 10);
    const huge = await (await changelogGET(new NextRequest("http://x/api/changelog?limit=1000"))).json();
    assert.equal(huge.releases.length, 12);
  } finally {
    if (saved === undefined) delete process.env.FOLDRUN_DEV_NO_AUTH;
    else process.env.FOLDRUN_DEV_NO_AUTH = saved;
  }
});

test("every /api response carries X-Foldrun-Version, X-Foldrun-Api and X-Foldrun-Cli — refusals too", async () => {
  write(record);
  const ok = await proxy(new NextRequest("http://x/api/workspaces"));
  assert.equal(ok.headers.get("x-foldrun-version"), "v2026.10.01.3");
  assert.equal(ok.headers.get("x-foldrun-api"), release.API_VERSION);
  assert.equal(ok.headers.get("x-foldrun-cli"), "0.7.0");
  const big = await proxy(new NextRequest("http://x/api/workspaces/a/source", { method: "PUT", headers: { "content-length": String(1024 * 1024 * 1024) } }));
  assert.equal(big.status, 413);
  assert.equal(big.headers.get("x-foldrun-version"), "v2026.10.01.3");
});

test("no CLI version known: no X-Foldrun-Cli header rather than an empty one", async () => {
  fs.rmSync(file, { force: true });
  release._resetReleaseCache();
  const res = await proxy(new NextRequest("http://x/api/workspaces"));
  assert.equal(res.headers.get("x-foldrun-version"), "dev");
  assert.equal(res.headers.get("x-foldrun-cli"), null);
});

test("browsers: the engines the runner image was built with, as the deploy read them out of it", async () => {
  assert.equal(release.versionInfo().browsers, null, "unset: the deploy did not say");
  process.env.FOLDRUN_RUNNER_ENGINES = "chromium,chrome,chrome-beta,firefox,webkit,lightpanda,obscura";
  try {
    const body = await (await versionGET()).json();
    assert.deepEqual(body.browsers, ["chromium", "chrome", "chrome-beta", "firefox", "webkit", "lightpanda", "obscura"]);
  } finally {
    delete process.env.FOLDRUN_RUNNER_ENGINES;
  }
  assert.deepEqual(release.runnerEngines("chromium, firefox,,<b>x</b>"), ["chromium", "firefox"], "only engine-shaped names");
  assert.equal(release.runnerEngines(""), null);
});

test("browser_versions: the dotted versions the deploy carried beside the names", async () => {
  assert.equal(release.versionInfo().browser_versions, null);
  process.env.FOLDRUN_RUNNER_ENGINES = "chromium,chrome=154.0.8037.58,firefox,lightpanda=0.4.1";
  try {
    const body = await (await versionGET()).json();
    assert.deepEqual(body.browsers, ["chromium", "chrome", "firefox", "lightpanda"], "the names, versions or not");
    assert.deepEqual(body.browser_versions, { chrome: "154.0.8037.58", lightpanda: "0.4.1" });
  } finally {
    delete process.env.FOLDRUN_RUNNER_ENGINES;
  }
  assert.deepEqual(release.runnerEngines("chrome=<b>1</b>,webkit"), ["webkit"], "a part that is not name=version is dropped whole");
  assert.equal(release.runnerEngineVersions("chromium,chrome"), null);
});

test("healthz reports the same version as /api/version: the file's, when the rollout set none", async () => {
  // Staging sets no FOLDRUN_VERSION; healthz said "dev" there while
  // /api/version said v2026.10.25.21 (26 Oct 2026).
  const { GET: healthzGET } = await import("../app/api/healthz/route.ts");
  delete process.env.FOLDRUN_VERSION;
  write(record);
  const health = (await (await healthzGET()).json()) as { version: string };
  const version = (await (await versionGET()).json()) as { version: string };
  assert.equal(health.version, "v2026.10.01.3");
  assert.equal(health.version, version.version);
  process.env.FOLDRUN_VERSION = "v2026.10.01.9";
  try {
    assert.equal(((await (await healthzGET()).json()) as { version: string }).version, "v2026.10.01.9", "the rollout's name still wins");
  } finally {
    delete process.env.FOLDRUN_VERSION;
  }
});
