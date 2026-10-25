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
  const send = () => rotate.POST(req("POST", "/api/workspaces/desk/hooks/publish/rotate", admin, {}, { "idempotency-key": "rot-1" }), ctx({ workspace: "desk", flow: "publish" }));
  const first = await send();
  assert.equal(first.status, 200);
  assert.match(((await first.json()) as { path: string }).path, /token=/);
  const again = await send();
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.equal(((await again.json()) as { path: string | null }).path, null);
  assert.equal(hookGeneration(TENANT, "desk", "publish"), 1);
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
