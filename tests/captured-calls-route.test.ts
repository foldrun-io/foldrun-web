// Captured calls through GET …/runs/<id>/calls/<call> (FOL-126 phase 7, step 2): a call kept in
// the object store reads back; one whose object is gone is a 502 that says so — never an empty 200;
// a call on the volume, and an unknown call, answer as before.
//
//   node --import ./tests/register.mjs --test tests/captured-calls-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-calls-route-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { registerPlatform } = await import("../../foldrun-core/src/platform.ts");
const { fsBlobStore } = await import("../../foldrun-core/src/blob-store.ts");
const { localRevisionStore } = await import("../../foldrun-core/src/revision-store.ts");
const { setRevisionBackend } = await import("../../foldrun-core/src/workspace-revisions.ts");
const { callSink, flushCalls } = await import("../../foldrun-core/src/captured-calls.ts");
const { recordCallIo } = await import("../../foldrun-core/src/capture.ts");
const { noPins } = await import("../../foldrun-core/src/blob-pins.ts");
const route = (await import("../app/api/workspaces/[workspace]/runs/[runId]/calls/[callId]/route.ts")) as {
  GET: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string; runId: string; callId: string }> }) => Promise<Response>;
};

const TENANT = "acme";
const WS = "desk";
const RUN = "run-calls-route";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "runs"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "runs", `${RUN}.json`), JSON.stringify({ id: RUN, flow: "adhoc:writer", status: "completed", startedAt: new Date().toISOString(), steps: [] }));

const { fakeRecords } = await import("../../foldrun-core/tests/fake-records.ts");
let on = true;
const port = fakeRecords({ callsOn: () => on });
registerPlatform({ records: port });
const record = { id: RUN, flow: "adhoc:writer", status: "completed", startedAt: new Date().toISOString(), steps: [] };
port.runPut(TENANT, WS, record as never, { id: RUN } as never, false);
setRevisionBackend({ blobs: fsBlobStore(path.join(DATA, ".objects")), revisions: localRevisionStore(path.join(DATA, ".revisions")), pins: noPins }, { journal: () => false, read: () => false });

const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");
const headers = { authorization: `Bearer ${key}` };
const get = (call: string) =>
  route.GET(new NextRequest(`http://localhost/api/workspaces/${WS}/runs/${RUN}/calls/${call}`, { headers }), { params: Promise.resolve({ workspace: WS, runId: RUN, callId: call }) });

test("a call kept in the object store reads back; a volume call and an unknown call answer as before", async () => {
  const step = {};
  recordCallIo(ws, RUN, "c1", "Bash", { input: "ls", output: "a.txt" }, (s) => s, callSink(step, { tenant: TENANT, workspace: WS, runId: RUN, workspaceRoot: ws }));
  await flushCalls(step);
  assert.equal(fs.existsSync(path.join(ws, "runs", RUN, "calls")), false, "nothing on the volume");
  const ok = await get("c1");
  assert.equal(ok.status, 200);
  assert.deepEqual(((await ok.json()) as { call: { input: string; output: string } }).call.output, "a.txt");
  on = false;
  const other = {};
  recordCallIo(ws, RUN, "c2", "Bash", { input: "pwd", output: "/w" }, (s) => s, callSink(other, { tenant: TENANT, workspace: WS, runId: RUN, workspaceRoot: ws }));
  await flushCalls(other);
  assert.equal(((await (await get("c2")).json()) as { call: { output: string } }).call.output, "/w");
  assert.equal((await get("nope")).status, 404);
});

test("a call whose object is gone is a 502 that says so, not an empty 200", async () => {
  on = true;
  const step = {};
  recordCallIo(ws, RUN, "c3", "Bash", { input: "i", output: "o" }, (s) => s, callSink(step, { tenant: TENANT, workspace: WS, runId: RUN, workspaceRoot: ws }));
  await flushCalls(step);
  assert.equal((await get("c3")).status, 200);
  fs.rmSync(path.join(DATA, ".objects"), { recursive: true, force: true });
  const res = await get("c3");
  assert.equal(res.status, 502);
  assert.match(((await res.json()) as { error: string }).error, /captured call unavailable/);
});
