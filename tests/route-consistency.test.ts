// The 5 Oct consistency pass, through the real handlers: a webhook rotate and
// a flow's appended step answer once per Idempotency-Key (the rotate's replay
// never repeats the token), a draft is refused before its body is read,
// observe and triggers take `days` with `since` still read, and a key scoped
// to some workspaces sees only those in /api/usage. A person releases a
// `wait: event` step with a payload through approve, under their own name.
//
//   node --import ./tests/register.mjs --test tests/route-consistency.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-route-consistency-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_REDIS_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { resetIdempotencyMemory } = await import("../server/idempotency.ts");
const { hookGeneration } = await import("@/lib/webhook");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const rotate = (await import("../app/api/workspaces/[workspace]/hooks/[flow]/rotate/route.ts")) as unknown as { POST: Handler };
const draft = (await import("../app/api/workspaces/[workspace]/flows/draft/route.ts")) as unknown as { POST: Handler };
const triggers = (await import("../app/api/workspaces/[workspace]/triggers/route.ts")) as unknown as { GET: Handler };
const observe = (await import("../app/api/workspaces/[workspace]/observe/route.ts")) as unknown as { GET: Handler };
const usage = (await import("../app/api/usage/route.ts")) as unknown as { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
const approve = (await import("../app/api/workspaces/[workspace]/runs/[runId]/approve/route.ts")) as unknown as { POST: Handler };
const bulk = (await import("../app/api/workspaces/[workspace]/runs/bulk/route.ts")) as unknown as { POST: Handler };
const stopRoute = (await import("../app/api/workspaces/[workspace]/runs/[runId]/stop/route.ts")) as unknown as { POST: Handler };
const rerunRoute = (await import("../app/api/workspaces/[workspace]/runs/[runId]/rerun/route.ts")) as unknown as { POST: Handler };
const { writeRun, readRun } = await import("@/lib/store");

const TENANT = "acme";
for (const ws of ["desk", "other"]) {
  const dir = path.join(DATA, TENANT, "workspaces", ws);
  fs.mkdirSync(path.join(dir, "flows"), { recursive: true });
  fs.mkdirSync(path.join(dir, "agents/writer"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `---\nname: ${ws}\n---\n`);
  fs.writeFileSync(path.join(dir, "agents/writer/agent.md"), "---\nname: writer\ndescription: Writes.\n---\n\nWrite.\n");
}
const DRAFT_FLOW = path.join(DATA, TENANT, "workspaces/desk/flows/draft.md");
fs.writeFileSync(DRAFT_FLOW, "---\nname: draft\n---\n\n1. [[writer]] — Write it.\n");
// Rotate refuses a flow that is not a webhook (30 Oct 2026): the one it rotates is one.
fs.writeFileSync(path.join(DATA, TENANT, "workspaces/desk/flows/hooked.md"), "---\nname: hooked\ntrigger: webhook\n---\n\n1. [[writer]] — Publish it.\n");

const { key: admin } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");
const { key: scoped } = await createApiKey(TENANT, "scoped", "owner@acme.test", undefined, "editor", ["desk"]);

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const req = (method: string, url: string, key?: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });

test("rotating a webhook twice with one Idempotency-Key rotates once, and the replay withholds the token", async () => {
  resetIdempotencyMemory();
  const send = () => rotate.POST(req("POST", "/api/workspaces/desk/hooks/hooked/rotate", admin, {}, { "idempotency-key": "rot-1" }), ctx({ workspace: "desk", flow: "hooked" }));
  const first = await send();
  assert.equal(first.status, 200);
  assert.match(((await first.json()) as { path: string }).path, /token=/);
  const again = await send();
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.equal(((await again.json()) as { path: string | null }).path, null);
  assert.equal(hookGeneration(TENANT, "desk", "hooked"), 1);
});

test("a step appended through flows/draft (a flow named draft) is appended once per key, not refused as in flight", async () => {
  resetIdempotencyMemory();
  const before = fs.readFileSync(DRAFT_FLOW, "utf8");
  const send = () => draft.POST(req("POST", "/api/workspaces/desk/flows/draft", admin, { target: "writer", instruction: "Again." }, { "idempotency-key": "step-1" }), ctx({ workspace: "desk" }));
  const first = await send();
  assert.equal(first.status, 200, await first.clone().text());
  const after = fs.readFileSync(DRAFT_FLOW, "utf8");
  assert.notEqual(after, before);
  const again = await send();
  assert.equal(again.status, 200);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.equal(fs.readFileSync(DRAFT_FLOW, "utf8"), after, "the replay wrote nothing");
});

test("a draft without a credential is 401 before its body is read, even a malformed one", async () => {
  const res = await draft.POST(req("POST", "/api/workspaces/desk/flows/draft", undefined, "{not json"), ctx({ workspace: "desk" }));
  assert.equal(res.status, 401);
  const bad = await draft.POST(req("POST", "/api/workspaces/desk/flows/draft", admin, "{not json"), ctx({ workspace: "desk" }));
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: string }).error, "malformed JSON");
});

test("triggers and observe take ?days=, still read ?since=, and clamp rather than refuse", async () => {
  const days = async (q: string) => ((await (await triggers.GET(req("GET", `/api/workspaces/desk/triggers${q}`, admin), ctx({ workspace: "desk" }))).json()) as { days: number }).days;
  assert.equal(await days(""), 7);
  assert.equal(await days("?days=3"), 3);
  assert.equal(await days("?since=5"), 5, "the older spelling still works");
  assert.equal(await days("?days=2&since=9"), 2, "days wins when both are sent");
  assert.equal(await days("?days=9999"), 365);
  assert.equal(await days("?days=abc"), 7);

  const window = async (q: string) => ((await (await observe.GET(req("GET", `/api/workspaces/desk/observe${q}`, admin), ctx({ workspace: "desk" }))).json()) as { sinceDays: number }).sinceDays;
  assert.equal(await window(""), 30);
  assert.equal(await window("?days=7"), 7);
  assert.equal(await window("?since=14"), 14);
  assert.equal(await window("?days=0"), 1);
});

test("a key scoped to some workspaces sees only those in /api/usage", async () => {
  const all = (await (await usage.GET(req("GET", "/api/usage", admin))).json()) as { workspaces: { workspace: string }[] };
  assert.deepEqual(all.workspaces.map((w) => w.workspace).sort(), ["desk", "other"]);
  const mine = (await (await usage.GET(req("GET", "/api/usage", scoped))).json()) as { workspaces: { workspace: string }[] };
  assert.deepEqual(mine.workspaces.map((w) => w.workspace), ["desk"]);
});

test("approve with a payload releases a wait: event step as the caller, and is a 400 anywhere else", async () => {
  resetIdempotencyMemory();
  const step = (extra: Record<string, unknown>) => ({ agent: "writer", instruction: "do it", group: 1, status: "awaiting-approval", events: [], ...extra });
  const park = (id: string, steps: Record<string, unknown>[]) =>
    writeRun(TENANT, "desk", { id, flow: "publish", status: "awaiting-approval", startedAt: new Date().toISOString(), finishedAt: null, steps } as never);
  const send = (id: string, body: unknown, key = "k-" + id) =>
    approve.POST(req("POST", `/api/workspaces/desk/runs/${id}/approve`, admin, body, { "idempotency-key": key }), ctx({ workspace: "desk", runId: id }));

  park("run-gate", [step({})]);
  const gate = await send("run-gate", { decision: "approve", payload: "x" });
  assert.equal(gate.status, 400);
  assert.match(((await gate.json()) as { error: string }).error, /wait: event/);
  assert.equal(readRun(TENANT, "desk", "run-gate")!.steps[0].status, "awaiting-approval", "nothing was decided");

  park("run-event", [step({ status: "completed", waitFor: undefined }), step({ waitFor: "event", group: 2 })]);
  assert.equal((await send("run-event", { decision: "reject", payload: "x" }, "k-rej")).status, 400);
  assert.equal((await send("run-event", { decision: "approve", step: 0, payload: "x" }, "k-0")).status, 400);
  const ok = await send("run-event", { decision: "approve", step: 1, payload: { status: "paid" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(((await ok.json()) as { steps: number[] }).steps, [1]);
  const released = readRun(TENANT, "desk", "run-event")!.steps[1];
  assert.equal(released.eventPayload, '{"status":"paid"}');
  assert.ok(released.events.some((e) => /approved by /.test(e.text) && !/external event/.test(e.text)), JSON.stringify(released.events));
  const replay = await send("run-event", { decision: "approve", step: 1, payload: { status: "paid" } });
  assert.equal(replay.headers.get("idempotent-replayed"), "true");
});

// 30 Oct 2026: any decision but the exact "reject" used to approve.
test("approve takes only decision approve or reject; anything else is a 400 that decides nothing", async () => {
  resetIdempotencyMemory();
  writeRun(TENANT, "desk", {
    id: "run-typo",
    flow: "publish",
    status: "awaiting-approval",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    steps: [{ agent: "writer", instruction: "do it", group: 1, status: "awaiting-approval", events: [] }],
  } as never);
  const send = (body: unknown, key: string) =>
    approve.POST(req("POST", "/api/workspaces/desk/runs/run-typo/approve", admin, body, { "idempotency-key": key }), ctx({ workspace: "desk", runId: "run-typo" }));
  for (const [i, body] of [{ decision: "deny" }, { decision: "REJECT" }, { decison: "reject" }, {}, { decision: "approve", step: "0" }, { decision: "approve", step: 0.5 }].entries()) {
    const res = await send(body, `k-typo-${i}`);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(readRun(TENANT, "desk", "run-typo")!.steps[0].status, "awaiting-approval", `${JSON.stringify(body)} decided nothing`);
  }
  const rejected = await send({ decision: "reject", step: 0 }, "k-typo-ok");
  assert.equal(rejected.status, 200);
  assert.equal(readRun(TENANT, "desk", "run-typo")!.steps[0].status, "failed");
});

// 30 Oct 2026: stop and rerun answered every refusal 400 (and step 1.5 a
// 500); a bulk action handed back a TypeError's text per run.
test("stop and rerun answer 404 for no run, 409 for the wrong state, 400 for a half step; bulk scrubs a fault", async () => {
  resetIdempotencyMemory();
  const runs = path.join(DATA, TENANT, "workspaces/other/runs");
  fs.mkdirSync(runs, { recursive: true });
  const at = new Date().toISOString();
  const one = { agent: "writer", instruction: "w", group: 1, optional: false, events: [], result: null, costUsd: 0 };
  fs.writeFileSync(path.join(runs, "run-done.json"), JSON.stringify({ id: "run-done", flow: "f", status: "completed", startedAt: at, finishedAt: at, steps: [{ ...one, status: "completed" }] }));
  fs.writeFileSync(path.join(runs, "run-live.json"), JSON.stringify({ id: "run-live", flow: "f", status: "awaiting-approval", startedAt: at, finishedAt: null, steps: [{ ...one, status: "awaiting-approval" }] }));
  // A record a fault reads: no steps array, so rerunFrom throws a TypeError.
  fs.writeFileSync(path.join(runs, "run-broken.json"), JSON.stringify({ id: "run-broken", flow: "f", status: "failed", startedAt: at, finishedAt: at, steps: null }));

  const stop = (id: string) => stopRoute.POST(req("POST", `/api/workspaces/other/runs/${id}/stop`, admin, {}, { "idempotency-key": `s-${id}` }), ctx({ workspace: "other", runId: id }));
  const rerun = (id: string, body: unknown, k: string) => rerunRoute.POST(req("POST", `/api/workspaces/other/runs/${id}/rerun`, admin, body, { "idempotency-key": k }), ctx({ workspace: "other", runId: id }));
  assert.equal((await stop("run-nowhere")).status, 404);
  assert.equal((await stop("run-done")).status, 409);
  assert.equal((await rerun("run-nowhere", { step: 1 }, "r1")).status, 404);
  assert.equal((await rerun("run-live", { step: 1 }, "r2")).status, 409);
  const half = await rerun("run-done", { step: 1.5 }, "r3");
  assert.equal(half.status, 400);
  assert.match(((await half.json()) as { error: string }).error, /whole number/);

  const send = (body: unknown, k: string) => bulk.POST(req("POST", "/api/workspaces/other/runs/bulk", admin, body, { "idempotency-key": k }), ctx({ workspace: "other" }));
  assert.equal((await send({ action: "rerun", runIds: ["run-done"], from: 1.5 }, "b1")).status, 400);
  const res = await send({ action: "rerun", runIds: ["run-broken"] }, "b2");
  assert.equal(res.status, 200);
  const { runs: out } = (await res.json()) as { runs: { runId: string; ok: boolean; error?: string }[] };
  assert.equal(out[0].ok, false);
  assert.equal(out[0].error, "something went wrong on our side");
  const stopped = (await (await send({ action: "stop", runIds: ["run-done"] }, "b3")).json()) as { runs: { error?: string }[] };
  assert.match(stopped.runs[0].error!, /nothing to stop/, "a refusal keeps its sentence");
});
