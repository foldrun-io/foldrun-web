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
