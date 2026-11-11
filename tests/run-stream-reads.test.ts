// GET /runs/<id>/stream reads the run file only when it changed (30 Oct
// 2026). Every open stream re-read the whole record every 250 ms for up to
// 30 minutes, so a few hundred streams on a large run were ~4 full reads a
// second each. Now a stat decides, the watch slows while nothing moves, and
// a change is still sent — and a finished run still ends the stream.
//
//   node --import ./tests/register.mjs --test tests/run-stream-reads.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-run-stream-"));
process.env.FOLDRUN_DATA = DATA;
process.env.FOLDRUN_DEV_NO_AUTH = "1";
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const route = await import("../app/api/workspaces/[workspace]/runs/[runId]/stream/route.ts");

const TENANT = "acme";
const WS = "desk";
const RUN = "run-stream-reads";
const ws = path.join(DATA, TENANT, "workspaces", WS);
fs.mkdirSync(path.join(ws, "runs"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
const file = path.join(ws, "runs", `${RUN}.json`);
const record = (status: string, note = "") =>
  JSON.stringify({ id: RUN, flow: "f", status, startedAt: "2026-10-30T00:00:00Z", steps: [], note });
fs.writeFileSync(file, record("running"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("an idle run is not re-read on every tick; a change is sent; a finished run ends the stream", async () => {
  // Count whole-file reads of this run record.
  const real = fs.readFileSync;
  let reads = 0;
  (fs as { readFileSync: typeof fs.readFileSync }).readFileSync = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (p === file) reads++;
    return (real as (...a: unknown[]) => unknown)(p, ...rest);
  }) as typeof fs.readFileSync;
  const abort = new AbortController();
  try {
    const res = await route.GET(
      new NextRequest(`http://x/api/workspaces/${WS}/runs/${RUN}/stream`, { headers: { "x-foldrun-tenant": TENANT }, signal: abort.signal }),
      { params: Promise.resolve({ workspace: WS, runId: RUN }) },
    );
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const pump = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += decoder.decode(value);
      }
    })();

    await sleep(1_500);
    assert.equal((text.match(/event: run/g) ?? []).length, 1, "the current state, once");
    // At 250 ms it was ~6 reads in 1.5 s; now the first one and none while the stat stands still.
    assert.ok(reads <= 2, `the idle record was read ${reads} times`);

    fs.writeFileSync(file, record("running", "a step wrote"));
    await sleep(2_600); // the idle watch is at most 2 s apart
    assert.match(text, /a step wrote/, "a change is still sent");

    fs.writeFileSync(file, record("completed", "done now"));
    await Promise.race([pump, sleep(3_000)]);
    assert.match(text, /event: done/, "a finished run ends the stream");
    // FOL-157: the money rides on `done` — the estimate, and not yet settled.
    const done = JSON.parse(/event: done\ndata: (.*)\n/.exec(text)![1]!);
    assert.equal(done.status, "completed");
    assert.equal(typeof done.estimatedUsd, "number");
    assert.equal(done.settled, false);
    assert.equal(done.chargedUsd, null);
  } finally {
    abort.abort();
    (fs as { readFileSync: typeof fs.readFileSync }).readFileSync = real;
  }
});

// FOL-75: a refusal is `{ error }` JSON, as on every JSON route and as the
// OpenAPI document says — it was plain text. Only a 200 is a stream.
test("a stream that cannot start answers { error } JSON, not plain text", async () => {
  const res = await route.GET(
    new NextRequest(`http://x/api/workspaces/${WS}/runs/no-such-run/stream`, { headers: { "x-foldrun-tenant": TENANT } }),
    { params: Promise.resolve({ workspace: WS, runId: "no-such-run" }) },
  );
  assert.equal(res.status, 404);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await res.json(), { error: "run not found" });
});

test("?delta=1: the whole record first with a cursor, then only what changed; a reconnect with Last-Event-ID resumes from there (FOL-158)", async () => {
  const D = "run-stream-delta";
  const f = path.join(ws, "runs", `${D}.json`);
  const rec = (status: string, events: number) =>
    JSON.stringify({ id: D, flow: "f", status, startedAt: "2026-11-11T00:00:00Z", steps: [{ agent: "a", status: "running", events: Array.from({ length: events }, (_, k) => ({ type: "text", text: `line ${k}` })) }] });
  fs.writeFileSync(f, rec("running", 2));
  const open = async (lastEventId?: string) => {
    const abort = new AbortController();
    const res = await route.GET(
      new NextRequest(`http://x/api/workspaces/${WS}/runs/${D}/stream?delta=1`, { headers: { "x-foldrun-tenant": TENANT, ...(lastEventId ? { "last-event-id": lastEventId } : {}) }, signal: abort.signal }),
      { params: Promise.resolve({ workspace: WS, runId: D }) },
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const state = { text: "" };
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        state.text += decoder.decode(value);
      }
    })();
    return { state, close: () => abort.abort() };
  };
  const a = await open();
  await sleep(600);
  assert.match(a.state.text, /^id: v1\.2\nevent: run\n/m, "the whole record first, with its cursor");
  fs.writeFileSync(f, rec("running", 3));
  await sleep(2_600);
  const delta = /id: (v1\.3)\nevent: delta\ndata: (.*)\n/.exec(a.state.text);
  assert.ok(delta, a.state.text.slice(-400));
  const body = JSON.parse(delta![2]!);
  assert.equal(body.steps["0"].from, 2);
  assert.deepEqual(body.steps["0"].events.map((e: { text: string }) => e.text), ["line 2"], "only the new event");
  a.close();

  fs.writeFileSync(f, rec("running", 5));
  const b = await open("v1.3");
  await sleep(600);
  assert.doesNotMatch(b.state.text, /event: run\n/, "a resume is not the whole record again");
  const resumed = JSON.parse(/event: delta\ndata: (.*)\n/.exec(b.state.text)![1]!);
  assert.deepEqual(resumed.steps["0"].events.map((e: { text: string }) => e.text), ["line 3", "line 4"]);
  b.close();

  const c = await open("v1.9");
  await sleep(600);
  assert.match(c.state.text, /event: run\n/, "a cursor that does not fit gets the whole record");
  c.close();
});
