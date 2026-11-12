// GET /runs/<id>/stream with the run's records in Postgres (12 Nov 2026): a
// write by any copy of the platform wakes the stream at once (run-notify.ts),
// so an idle stream asks the database for the run's stamp only every 10 s
// instead of every 2 s — each ask is a blocking round trip on the web
// process's event loop.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/run-stream-notify-db.test.ts

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-run-stream-db-"));
process.env.FOLDRUN_DATA = DATA;
process.env.FOLDRUN_DEV_NO_AUTH = "1";
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
}

const TENANT = "acme";
const WS = "desk";
const RUN = "run-stream-notify";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

after(async () => {
  if (!url) return;
  const { stopListening } = await import("../../foldrun-platform/src/pg-listen.ts");
  await stopListening();
  const { closePgSync } = await import("../../foldrun-platform/src/pg-sync.ts");
  await closePgSync();
  const { db } = await import("../../foldrun-platform/src/db.ts");
  await db()?.end();
  const { resetPlatform } = await import("../../foldrun-core/src/platform.ts");
  resetPlatform();
});

test("a write wakes an idle stream at once, and an idle stream rarely asks the database", opts, async () => {
  const { migrate } = await import("../../foldrun-platform/src/db.ts");
  await migrate();
  const { pgRecords } = await import("../../foldrun-platform/src/records-pg.ts");
  const { registerPlatform } = await import("../../foldrun-core/src/platform.ts");
  const port = pgRecords({ routed: false });
  let stamps = 0;
  const realStamp = port.runStamp.bind(port);
  port.runStamp = (t, w, id) => {
    if (id === RUN) stamps++;
    return realStamp(t, w, id);
  };
  registerPlatform({ records: port });
  const store = await import("../../foldrun-core/src/store.ts");
  const { runNotifyLive } = await import("../../foldrun-platform/src/run-notify.ts");
  fs.mkdirSync(path.join(DATA, TENANT, "workspaces", WS, "runs"), { recursive: true });
  fs.writeFileSync(path.join(DATA, TENANT, "workspaces", WS, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
  const record = (status: string, note: string) => ({ id: RUN, flow: "f", status, startedAt: "2026-11-12T00:00:00Z", steps: [], note });
  store.writeRun(TENANT, WS, record("running", "first") as never);

  const route = await import("../app/api/workspaces/[workspace]/runs/[runId]/stream/route.ts");
  const { NextRequest } = await import("next/server");
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
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) return;
        text += decoder.decode(value);
      }
    })();

    // Long enough for the idle watch to back off past the old 2 s ceiling.
    for (let i = 0; i < 40 && !runNotifyLive(); i++) await sleep(50);
    assert.ok(runNotifyLive(), "the listener is up");
    await sleep(4_000);
    const idleFrom = stamps;
    await sleep(4_000);
    assert.ok(stamps - idleFrom <= 1, `an idle stream asked for the stamp ${stamps - idleFrom} times in 4 s (it was every 2 s)`);

    store.writeRun(TENANT, WS, record("running", "a step wrote") as never);
    const t0 = Date.now();
    while (!/a step wrote/.test(text) && Date.now() - t0 < 3_000) await sleep(20);
    const took = Date.now() - t0;
    assert.match(text, /a step wrote/, "the change is sent");
    assert.ok(took < 800, `the change arrived ${took} ms after the write (an idle poll would have taken seconds)`);

    store.writeRun(TENANT, WS, record("completed", "done now") as never);
    const t1 = Date.now();
    while (!/event: done/.test(text) && Date.now() - t1 < 3_000) await sleep(20);
    assert.match(text, /event: done/, "a finished run still ends the stream");
  } finally {
    abort.abort();
    store.deleteRun?.(TENANT, WS, RUN);
  }
});
