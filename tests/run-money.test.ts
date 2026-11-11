// FOL-157: a run's money on GET …/runs/<id> — the list-price estimate until
// the ledger settles it, then the charge, and which is final.
//
//   node --import ./tests/register.mjs --test tests/run-money.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-run-money-"));
process.env.FOLDRUN_DATA = DATA;
process.env.FOLDRUN_DEV_NO_AUTH = "1";
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
delete process.env.FOLDRUN_DATABASE_URL;

const { NextRequest } = await import("next/server");
const route = (await import("../app/api/workspaces/[workspace]/runs/[runId]/route.ts")) as unknown as {
  GET: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string; runId: string }> }) => Promise<Response>;
};
const { appendLedgerFile } = await import("@/platform/ledger");

const T = "acme", WS = "desk", RUN = "run-money-1";
const ws = path.join(DATA, T, "workspaces", WS);
fs.mkdirSync(path.join(ws, "runs"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "runs", `${RUN}.json`), JSON.stringify({ id: RUN, flow: "f", status: "completed", startedAt: "2026-11-11T00:00:00Z", finishedAt: "2026-11-11T00:01:00Z", steps: [{ agent: "a", status: "completed", costUsd: 0.02, events: [], result: "ok" }] }));
const get = async () => (await route.GET(new NextRequest(`http://x/api/workspaces/${WS}/runs/${RUN}`, { headers: { "x-foldrun-tenant": T } }), { params: Promise.resolve({ workspace: WS, runId: RUN }) })).json();

test("the estimate until the ledger settles the run, then the charge — and which is final", async () => {
  const before = await get();
  assert.equal(before.chargedUsd, null);
  assert.equal(before.settled, false);
  assert.equal(typeof before.estimatedUsd, "number");
  appendLedgerFile(T, [{ t: new Date().toISOString(), kind: "run", usd: -0.05, runId: RUN } as never]);
  const after = await get();
  assert.equal(after.settled, true);
  assert.equal(after.chargedUsd, 0.05);
  assert.equal(after.id, RUN, "the record is still all there");
});
