// Run outputs published to the object store (FOL-126 phase 5), through the
// real routes: /files lists them and names what was not kept, /archive serves
// them (whole, a Range slice, a 404), and a run archived on the volume before
// the switch is still served beside them.
//
//   node --import ./tests/register.mjs --test tests/run-outputs-routes.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-run-outputs-routes-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { fsBlobStore } = await import("@/lib/blob-store");
const { localRunOutputStore, publishRunOutputs, noteRefused, setRunOutputsBackend } = await import("@/lib/run-outputs");
type Ctx<P> = { params: Promise<P> };
type Route = { GET: (req: InstanceType<typeof NextRequest>, ctx: Ctx<{ workspace: string; runId: string }>) => Promise<Response> };
const archive = (await import("../app/api/workspaces/[workspace]/runs/[runId]/archive/route.ts")) as Route;
const files = (await import("../app/api/workspaces/[workspace]/runs/[runId]/files/route.ts")) as Route;

const TENANT = "acme";
const WS = "desk";
const STORED = "run-stored";
const VOLUME = "run-volume";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);

const MIB = 1048576;
const backend = {
  blobs: fsBlobStore(path.join(DATA, ".objects")),
  store: localRunOutputStore(path.join(DATA, ".run-outputs")),
  enabled: () => true,
  fileMaxBytes: () => 100,
  runMaxBytes: () => MIB,
};
setRunOutputsBackend(backend);

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-out-"));
fs.mkdirSync(path.join(outDir, "data"));
fs.writeFileSync(path.join(outDir, "report.md"), "# report\n");
fs.writeFileSync(path.join(outDir, "data", "rows.csv"), "0123456789");
fs.writeFileSync(path.join(outDir, "huge.bin"), "x".repeat(500));
const published = await publishRunOutputs(backend, TENANT, WS, STORED, "writer", outDir);
const run = { id: STORED, flow: "adhoc:writer", status: "completed", startedAt: new Date().toISOString(), steps: [{ status: "completed", events: [] as never[] }] } as { steps: { status: string; events: never[] }[]; [k: string]: unknown };
noteRefused(run as never, published.refused);
fs.mkdirSync(path.join(ws, "runs"), { recursive: true });
fs.writeFileSync(path.join(ws, "runs", `${STORED}.json`), JSON.stringify(run));

// a run archived on the volume, before outputs moved to the store
const vol = path.join(ws, "runs", VOLUME, "outputs", "writer");
fs.mkdirSync(vol, { recursive: true });
fs.writeFileSync(path.join(vol, "old.md"), "from the volume");
fs.writeFileSync(path.join(ws, "runs", `${VOLUME}.json`), JSON.stringify({ id: VOLUME, flow: "adhoc:writer", status: "completed", startedAt: new Date().toISOString(), steps: [] }));

const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "admin");
const headers = { authorization: `Bearer ${key}` };
const ctx = (runId: string) => ({ params: Promise.resolve({ workspace: WS, runId }) });
const list = (runId: string) => files.GET(new NextRequest(`http://localhost/api/workspaces/${WS}/runs/${runId}/files`, { headers }), ctx(runId));
const fetchOutput = (runId: string, rel: string, extra: Record<string, string> = {}) =>
  archive.GET(new NextRequest(`http://localhost/api/workspaces/${WS}/runs/${runId}/archive?agent=writer&path=${encodeURIComponent(rel)}`, { headers: { ...headers, ...extra } }), ctx(runId));

test("/files lists what the store holds and names what was not kept, with the limit", async () => {
  const res = await list(STORED);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { files: { agent: string; path: string; bytes: number; href: string }[]; totalBytes: number; refused: unknown[]; refusedCount: number };
  assert.deepEqual(body.files.map((f) => `${f.agent}/${f.path}:${f.bytes}`), ["writer/data/rows.csv:10", "writer/report.md:9"]);
  assert.equal(body.totalBytes, 19);
  assert.deepEqual(body.refused, [{ agent: "writer", path: "huge.bin", bytes: 500, reason: "file-cap", limit: 100 }]);
  assert.equal(body.refusedCount, 1);
  assert.match(body.files[0].href, /\/archive\?agent=writer&path=data%2Frows\.csv$/);
});

test("/archive serves a stored file whole, with its type, and as an inline download", async () => {
  const res = await fetchOutput(STORED, "report.md");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "# report\n");
  assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(res.headers.get("content-length"), "9");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-disposition") ?? "", /^inline; filename/);
});

test("/archive answers a Range with 206 and exactly that slice (a video seeks this way)", async () => {
  const res = await fetchOutput(STORED, "data/rows.csv", { range: "bytes=3-6" });
  assert.equal(res.status, 206);
  assert.equal(await res.text(), "3456");
  assert.equal(res.headers.get("content-range"), "bytes 3-6/10");
  assert.equal((await fetchOutput(STORED, "data/rows.csv", { range: "bytes=50-60" })).status, 416);
});

test("/archive: a file that was refused, one that never existed, and a path that climbs are all 404", async () => {
  for (const rel of ["huge.bin", "nope.txt", "../report.md", "data/../../x"]) assert.equal((await fetchOutput(STORED, rel)).status, 404, rel);
});

test("a run archived on the volume before the switch is served beside it", async () => {
  const res = await list(VOLUME);
  const body = (await res.json()) as { files: { path: string }[]; refused: unknown[]; refusedCount: number };
  assert.deepEqual(body.files.map((f) => f.path), ["old.md"]);
  assert.deepEqual(body.refused, []);
  assert.equal(body.refusedCount, 0);
  assert.equal(await (await fetchOutput(VOLUME, "old.md")).text(), "from the volume");
});

test("a store whose blob is gone answers an error, never an empty file", async () => {
  const { blobObjectKey, sha256Hex } = await import("@/lib/manifest");
  const sweeper = backend.blobs as unknown as { delete(key: string): Promise<void> };
  await sweeper.delete(blobObjectKey(TENANT, sha256Hex("# report\n")));
  const res = await fetchOutput(STORED, "report.md");
  assert.equal(res.status, 502, "a fault on our side, not a 400 and not an empty 200");
  assert.match(((await res.json()) as { error: string }).error, /could not be read from storage/);
});
