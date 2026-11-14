// FIX-1 of the 14 Nov authorization matrix: a viewer read the release URL of a
// run parked on `wait: event` out of the run's own trace — GET …/runs/<id> and
// its …/stream — and that URL needs no credential, so a viewer (or a leaked
// viewer key) could POST it and release the step with an event of their
// choosing ("paid"). The record keeps the line; a caller who may not run things
// is no longer handed the link. An editor still is (they can release the step
// through POST …/approve anyway, and the dashboard shows them the URL).
//
//   node --import ./tests/register.mjs --test tests/run-event-link-viewer.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-event-link-viewer-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { writeRun, readRun } = await import("../../foldrun-core/src/store.ts");
const { eventUrl } = await import("../../foldrun-core/src/webhook.ts");
const { runTextFor, runFor } = await import("../server/run-links.ts");
type Ctx = { params: Promise<{ workspace: string; runId: string }> };
const run = (await import("../app/api/workspaces/[workspace]/runs/[runId]/route.ts")) as { GET: (r: InstanceType<typeof NextRequest>, c: Ctx) => Promise<Response> };
const stream = (await import("../app/api/workspaces/[workspace]/runs/[runId]/stream/route.ts")) as { GET: (r: InstanceType<typeof NextRequest>, c: Ctx) => Promise<Response> };
const events = await import("../app/api/events/[tenant]/[workspace]/[runId]/route.ts");

const TENANT = "acme";
const WS = "desk";
const ID = "run-parked-viewer";
const AT = "2026-11-14T01:00:00.000Z";
fs.mkdirSync(path.join(DATA, TENANT, "workspaces", WS), { recursive: true });
fs.writeFileSync(path.join(DATA, TENANT, "workspaces", WS, "AGENTS.md"), `---\nname: ${WS}\n---\n`);
const url = eventUrl(TENANT, WS, ID, { step: 0, at: AT });
const token = new URL(url, "http://x").searchParams.get("token")!;
writeRun(TENANT, WS, {
  id: ID, flow: "f", status: "awaiting-approval", startedAt: AT, finishedAt: null,
  steps: [{ agent: "a", instruction: "wait", group: 1, optional: false, waitFor: "event", status: "awaiting-approval", result: null, costUsd: null,
    events: [{ t: AT, type: "info", text: `waiting for an external event — release it with POST ${url}` }] }],
} as never);

const keys = {
  viewer: (await createApiKey(TENANT, "v", "v@acme.test", undefined, "viewer")).key,
  editor: (await createApiKey(TENANT, "e", "e@acme.test", undefined, "editor")).key,
};
const ctx: Ctx = { params: Promise.resolve({ workspace: WS, runId: ID }) };
const as = (k: string) => new NextRequest(`http://localhost/api/workspaces/${WS}/runs/${ID}`, { headers: { authorization: `Bearer ${k}` } });

async function firstFrame(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const first = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(first.value);
}

test("a viewer's read of the run, whole and streamed, has no release link; the line is still there to say a gate waits", async () => {
  const body = await (await run.GET(as(keys.viewer), ctx)).text();
  assert.ok(!body.includes(token), "no token in GET …/runs/<id>");
  assert.match(body, /waiting for an external event — release it with the link an editor sees/);
  const frame = await firstFrame(await stream.GET(as(keys.viewer), ctx));
  assert.ok(frame.startsWith("id:") || frame.includes("event: run"), "a run frame came");
  assert.ok(!frame.includes(token), "no token in the stream");
  assert.ok(frame.includes("an external event"));
});

test("an editor still gets the link, and it still releases the step; the viewer's cannot be guessed from what they saw", async () => {
  const body = await (await run.GET(as(keys.editor), ctx)).text();
  assert.ok(body.includes(token));
  assert.ok((await firstFrame(await stream.GET(as(keys.editor), ctx))).includes(token));
  const u = new URL(url, "http://x");
  const post = (t: string) =>
    events.POST(new NextRequest(`http://localhost${u.pathname}?token=${t}&step=0`, { method: "POST", body: "paid" }), { params: Promise.resolve({ tenant: TENANT, workspace: WS, runId: ID }) });
  assert.equal((await post("hidden")).status, 401, "what a viewer is shown is not a token");
  assert.equal((await post(token)).status, 200);
  assert.ok(readRun(TENANT, WS, ID));
});

test("runTextFor and runFor: only the release line changes, only for a caller who may not run things", () => {
  const raw = JSON.stringify({ steps: [{ events: [{ text: `release it with POST ${url}` }, { text: "other POST /api/x" }] }] });
  assert.equal(runTextFor(raw, { role: "editor" }), raw);
  const viewer = runTextFor(raw, { role: "viewer" });
  assert.ok(!viewer.includes(token) && viewer.includes("other POST /api/x"));
  assert.doesNotThrow(() => JSON.parse(viewer));
  const plain = { id: "x", steps: [] };
  assert.equal(runFor(plain, { role: "viewer" }), plain, "nothing to hide: the same object");
});
