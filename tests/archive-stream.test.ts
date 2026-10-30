// GET /runs/<id>/archive streams (30 Oct 2026). Without a Range it read the
// whole archived file into memory, and `bytes=0-` buffered the same — a few
// parallel fetches of a multi-GB browser recording held it all on the pod.
// The answers are unchanged: whole file 200, a range 206, a bad range 416.
//
//   node --import ./tests/register.mjs --test tests/archive-stream.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-archive-stream-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const archive = (await import("../app/api/workspaces/[workspace]/runs/[runId]/archive/route.ts")) as {
  GET: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string; runId: string }> }) => Promise<Response>;
};

const TENANT = "acme";
const WS = "desk";
const RUN = "run-archive-stream";
const ws = path.join(DATA, TENANT, "workspaces", WS);
const out = path.join(ws, "runs", RUN, "outputs", "browser");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
fs.writeFileSync(path.join(ws, "runs", `${RUN}.json`), JSON.stringify({ id: RUN, flow: "adhoc:browser", status: "completed", startedAt: new Date().toISOString(), steps: [] }));
const BYTES = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251));
fs.writeFileSync(path.join(out, "clip.webm"), BYTES);
fs.writeFileSync(path.join(out, "empty.txt"), "");

const { key } = await createApiKey(TENANT, "test", "owner@acme.test", undefined, "viewer");
const fetchOutput = (rel: string, range?: string) =>
  archive.GET(
    new NextRequest(`http://localhost/api/workspaces/${WS}/runs/${RUN}/archive?agent=browser&path=${encodeURIComponent(rel)}`, {
      headers: { authorization: `Bearer ${key}`, ...(range ? { range } : {}) },
    }),
    { params: Promise.resolve({ workspace: WS, runId: RUN }) },
  );

test("the whole file is a 200 with its length, the same bytes, and never a buffered read", async () => {
  const res = await fetchOutput("clip.webm");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(BYTES.length));
  assert.equal(res.headers.get("content-type"), "video/webm");
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(BYTES));
  const src = fs.readFileSync(new URL("../app/api/workspaces/[workspace]/runs/[runId]/archive/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /readFileSync|Buffer\.alloc/, "the route streams; it does not read the file into memory");
});

test("a range is a 206 with exactly those bytes; a bad one is 416", async () => {
  const res = await fetchOutput("clip.webm", "bytes=1000-1999");
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes 1000-1999/${BYTES.length}`);
  assert.equal(res.headers.get("content-length"), "1000");
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(BYTES.subarray(1000, 2000)));
  const tail = await fetchOutput("clip.webm", "bytes=-10");
  assert.ok(Buffer.from(await tail.arrayBuffer()).equals(BYTES.subarray(BYTES.length - 10)));
  assert.equal((await fetchOutput("clip.webm", `bytes=${BYTES.length}-`)).status, 416);
});

test("an empty file is a 200 with no body", async () => {
  const res = await fetchOutput("empty.txt");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), "0");
  assert.equal(await res.text(), "");
});
