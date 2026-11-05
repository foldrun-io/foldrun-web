// FOL-124: the customer's own ways to erase run content before the retention
// window does — one run (DELETE …/runs/<id>) and every finished run that
// started before a date (POST …/runs/bulk { action: "delete", until }) — and
// the reason a failed run gives on one run's GET, the same as the list's.
//
//   node --import ./tests/register.mjs --test tests/run-content-delete.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-run-delete-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const bulkRoute = await import("../app/api/workspaces/[workspace]/runs/bulk/route.ts");
const runRoute = await import("../app/api/workspaces/[workspace]/runs/[runId]/route.ts");
const listRoute = await import("../app/api/workspaces/[workspace]/runs/route.ts");

const TENANT = "acme";
const WS = "desk";
const runs = path.join(DATA, TENANT, "workspaces", WS, "runs");
fs.mkdirSync(runs, { recursive: true });
fs.writeFileSync(path.join(DATA, TENANT, "workspaces", WS, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
const put = (id: string, status: string, startedAt: string, steps: unknown[] = []) => {
  fs.writeFileSync(path.join(runs, `${id}.json`), JSON.stringify({ id, flow: "digest", status, startedAt, finishedAt: status === "running" ? null : startedAt, steps }));
  fs.mkdirSync(path.join(runs, id, "outputs", "writer"), { recursive: true });
  fs.writeFileSync(path.join(runs, id, "outputs", "writer", "out.md"), "content");
};

const { key: editor } = await createApiKey(TENANT, "ed", "owner@acme.test", undefined, "editor");
const { key: admin } = await createApiKey(TENANT, "ad", "owner@acme.test", undefined, "admin");
const post = (key: string, body: unknown) =>
  bulkRoute.POST(
    new NextRequest(`http://localhost/api/workspaces/${WS}/runs/bulk`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspace: WS }) },
  );
const get = (key: string, id: string) =>
  runRoute.GET(new NextRequest(`http://localhost/api/workspaces/${WS}/runs/${id}`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ workspace: WS, runId: id }) });

test("delete everything older than a date: finished runs only, an admin's, record and outputs both", async () => {
  for (let i = 0; i < 105; i++) put(`run-old${String(i).padStart(3, "0")}`, "completed", `2026-07-01T${String(i % 24).padStart(2, "0")}:00:00Z`);
  put("run-live", "running", "2026-07-02T00:00:00Z");
  put("run-new", "completed", "2026-10-30T00:00:00Z");
  // An editor may run things, not erase them — a preview included.
  assert.equal((await post(editor, { action: "delete", until: "2026-08-01T00:00:00Z", dryRun: true })).status, 403);
  const preview = await (await post(admin, { action: "delete", until: "2026-08-01T00:00:00Z", dryRun: true })).json();
  assert.equal(preview.matched.length, 100, "a call's share");
  assert.equal(preview.remaining, 5);
  assert.ok(!preview.matched.includes("run-live"), "a live run is never in a delete");
  assert.ok(fs.existsSync(path.join(runs, "run-old000.json")), "a dry run touches nothing");

  const first = await (await post(admin, { action: "delete", until: "2026-08-01T00:00:00Z" })).json();
  assert.deepEqual([first.succeeded, first.failed, first.remaining], [100, 0, 5], "more than the cap is not a 422: it pages");
  const second = await (await post(admin, { action: "delete", until: "2026-08-01T00:00:00Z" })).json();
  assert.deepEqual([second.succeeded, second.remaining], [5, 0]);
  for (let i = 0; i < 105; i++) {
    const id = `run-old${String(i).padStart(3, "0")}`;
    assert.ok(!fs.existsSync(path.join(runs, `${id}.json`)) && !fs.existsSync(path.join(runs, id)), `${id}: record and outputs gone`);
  }
  assert.ok(fs.existsSync(path.join(runs, "run-live.json")), "the live run stays");
  assert.ok(fs.existsSync(path.join(runs, "run-new.json")), "a run after the date stays");
  assert.equal((await post(admin, { action: "delete", until: "2026-08-01T00:00:00Z", from: 2 })).status, 400);
});

test("one run's GET says why it failed, as the list does — class, message and fix", async () => {
  put("run-oom", "failed", "2026-11-01T00:00:00Z", [
    { agent: "writer", instruction: "x", group: 1, optional: false, status: "failed", result: null, costUsd: null, size: "large", reserved: { cpus: 2, memGiB: 4 }, actual: { busyCpuSecs: 1, peakMemBytes: 3.9 * 1024 ** 3, rxBytes: null, txBytes: null }, events: [{ t: "2026-11-01T00:01:00Z", type: "error", text: "sandbox ended: OOMKilled (exit 137)" }] },
  ]);
  const one = await (await get(editor, "run-oom")).json();
  assert.equal(one.failure.class, "oom");
  assert.equal(one.failure.kind, "memory");
  assert.equal(one.failure.message, "The step ran out of memory. Memory limit: 4 GiB; last recorded peak: 3.9 GiB.");
  assert.match(one.failure.fix, /size:/);
  assert.equal(one.failure.reason, "sandbox ended: OOMKilled (exit 137)", "the step's own words stay beside it");
  const list = await (await listRoute.GET(new NextRequest(`http://localhost/api/workspaces/${WS}/runs`, { headers: { authorization: `Bearer ${editor}` } }), { params: Promise.resolve({ workspace: WS }) })).json();
  const row = list.runs.find((r: { id: string }) => r.id === "run-oom");
  assert.equal(row.failure.message, one.failure.message, "the list says the same");
  const ok = await (await get(editor, "run-new")).json();
  assert.equal(ok.failure, null);
});
