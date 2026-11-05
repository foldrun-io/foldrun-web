// POST /runs/bulk selects off the runs index (30 Oct 2026). select() used
// listRuns, which JSON-parsed every run record in the workspace on every
// call — dry runs included — where the list route reads the index. The
// filter means the same; a second call reads no record at all.
//
//   node --import ./tests/register.mjs --test tests/runs-bulk-index.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-runs-bulk-index-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const route = await import("../app/api/workspaces/[workspace]/runs/bulk/route.ts");

const TENANT = "acme";
const WS = "desk";
const runs = path.join(DATA, TENANT, "workspaces", WS, "runs");
fs.mkdirSync(runs, { recursive: true });
fs.writeFileSync(path.join(DATA, TENANT, "workspaces", WS, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
const put = (id: string, flow: string, status: string, startedAt: string) =>
  fs.writeFileSync(path.join(runs, `${id}.json`), JSON.stringify({ id, flow, status, startedAt, steps: [] }));
put("run-a", "digest", "failed", "2026-10-28T01:00:00Z");
put("run-b", "digest", "completed", "2026-10-29T01:00:00Z");
put("run-c", "other", "failed", "2026-10-30T01:00:00Z");

const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "editor");
const bulk = (body: unknown) =>
  route.POST(
    new NextRequest(`http://localhost/api/workspaces/${WS}/runs/bulk`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspace: WS }) },
  );

test("a dry run matches the same runs, newest first, and a second call parses no record", async () => {
  const first = await (await bulk({ action: "rerun", status: ["failed"], dryRun: true })).json();
  assert.deepEqual(first.matched, ["run-c", "run-a"]);
  const flow = await (await bulk({ action: "stop", flow: "digest", since: "2026-10-29T00:00:00Z", dryRun: true })).json();
  assert.deepEqual(flow.matched, ["run-b"]);

  const real = fs.readFileSync;
  let reads = 0;
  (fs as { readFileSync: typeof fs.readFileSync }).readFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (typeof p === "string" && p.startsWith(runs + path.sep) && /run-[abc]\.json$/.test(p)) reads++;
    return (real as (...a: unknown[]) => unknown)(p, ...rest);
  }) as typeof fs.readFileSync;
  try {
    const again = await (await bulk({ action: "rerun", status: ["failed"], dryRun: true })).json();
    assert.deepEqual(again.matched, ["run-c", "run-a"]);
  } finally {
    (fs as { readFileSync: typeof fs.readFileSync }).readFileSync = real;
  }
  assert.equal(reads, 0, "the index answered; no run record was read");
});

test('status "stopped" matches a run a person stopped (stored as failed), and "failed" still matches it', async () => {
  const ws2 = "stops";
  const dir = path.join(DATA, TENANT, "workspaces", ws2, "runs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(DATA, TENANT, "workspaces", ws2, "AGENTS.md"), `---\nname: ${ws2}\n---\n`);
  const at = (id: string, status: string, startedAt: string, extra = {}) =>
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, flow: "digest", status, startedAt, steps: [], ...extra }));
  at("run-stopped", "failed", "2026-10-30T02:00:00Z", { stopRequested: true });
  at("run-broke", "failed", "2026-10-30T01:00:00Z");
  const call = async (status: string[]) =>
    (await (await route.POST(
      new NextRequest(`http://localhost/api/workspaces/${ws2}/runs/bulk`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "rerun", status, dryRun: true }),
      }),
      { params: Promise.resolve({ workspace: ws2 }) },
    )).json()).matched;
  assert.deepEqual(await call(["stopped"]), ["run-stopped"]);
  assert.deepEqual(await call(["failed"]), ["run-stopped", "run-broke"], "unchanged: failed still names both");
});

// FOL-75: delete is a bulk action too — the runs list's bar and
// `foldrun runs rm <id>…` used to loop one DELETE per run. Same permission
// as that DELETE (workspace:manage), each run its own outcome.
test("delete: an editor is refused; an admin erases the named runs, and one not there is its own refusal", async () => {
  const ws3 = "erase";
  const dir = path.join(DATA, TENANT, "workspaces", ws3, "runs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(DATA, TENANT, "workspaces", ws3, "AGENTS.md"), `---\nname: ${ws3}\n---\n`);
  for (const id of ["run-x", "run-y", "run-z"]) {
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, flow: "digest", status: "completed", startedAt: "2026-10-30T01:00:00Z", finishedAt: "2026-10-30T01:05:00Z", steps: [] }));
  }
  const { key: admin } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");
  const call = async (k: string, body: unknown) => {
    const res = await route.POST(
      new NextRequest(`http://localhost/api/workspaces/${ws3}/runs/bulk`, {
        method: "POST",
        headers: { authorization: `Bearer ${k}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ workspace: ws3 }) },
    );
    return { status: res.status, body: await res.json() };
  };
  const editor = await call(key, { action: "delete", runIds: ["run-x"] });
  assert.equal(editor.status, 403, "erasing a trail is workspace:manage, as DELETE …/runs/<id>");
  assert.ok(fs.existsSync(path.join(dir, "run-x.json")));
  assert.equal((await call(admin, { action: "delete", runIds: ["run-x"], from: 2 })).status, 400, "from is a rerun's");
  const dry = await call(admin, { action: "delete", runIds: ["run-x", "run-y"], dryRun: true });
  assert.deepEqual(dry.body.matched.sort(), ["run-x", "run-y"]);
  assert.ok(fs.existsSync(path.join(dir, "run-x.json")), "a dry run touches nothing");
  const done = await call(admin, { action: "delete", runIds: ["run-x", "run-y", "run-gone"] });
  assert.equal(done.status, 200);
  assert.equal(done.body.action, "delete");
  assert.equal(done.body.succeeded, 2);
  assert.deepEqual(done.body.runs.find((r: { runId: string }) => r.runId === "run-gone"), { runId: "run-gone", ok: false, error: "run not found" });
  assert.ok(!fs.existsSync(path.join(dir, "run-x.json")) && !fs.existsSync(path.join(dir, "run-y.json")));
  assert.ok(fs.existsSync(path.join(dir, "run-z.json")), "only the runs named");
});
