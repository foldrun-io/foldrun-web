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
  } finally {
    abort.abort();
    (fs as { readFileSync: typeof fs.readFileSync }).readFileSync = real;
  }
});
