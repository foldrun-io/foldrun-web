// End customers (FOL-168): GET/PATCH /api/customers and PUT/DELETE
// /api/customers/<id>/block — readable by anyone in the account, changed by
// an admin over every workspace, refused for a scoped key, audited.
//
//   node --import ./tests/register.mjs --test tests/customers-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-customers-route-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
fs.mkdirSync(path.join(process.env.FOLDRUN_DATA, "acme", "workspaces", "desk"), { recursive: true });
fs.writeFileSync(path.join(process.env.FOLDRUN_DATA, "acme", "workspaces", "desk", "AGENTS.md"), "---\nname: desk\n---\n");

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const list = await import("../app/api/customers/route.ts");
const block = await import("../app/api/customers/[customer]/block/route.ts");
const usage = await import("../app/api/customers/usage/route.ts");

const admin = (await createApiKey("acme", "admin", "ana@acme.test", undefined, "admin")).key;
const viewer = (await createApiKey("acme", "view", undefined, undefined, "viewer")).key;
const scoped = (await createApiKey("acme", "scoped admin", undefined, undefined, "admin", ["desk"])).key;

const req = (method: string, key: string, body?: unknown, url = "https://app.example.test/api/customers") =>
  new NextRequest(url, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const p = (customer: string) => ({ params: Promise.resolve({ customer }) });

test("limits and blocks: read by anyone in the account; changed by an admin over every workspace; bad input refused", async () => {
  const got = await (await list.GET(req("GET", viewer))).json();
  assert.deepEqual(got.limits, got.defaults);
  assert.deepEqual(got.blocked, []);

  assert.equal((await list.PATCH(req("PATCH", viewer, { startsPerMinute: 5 }))).status, 403);
  assert.equal((await list.PATCH(req("PATCH", scoped, { startsPerMinute: 5 }))).status, 403, "a key scoped to some workspaces holds not the whole account");
  assert.equal((await list.PATCH(req("PATCH", admin, { startsPerMinute: 0 }))).status, 400);
  const set = await (await list.PATCH(req("PATCH", admin, { startsPerMinute: 5, gatewayRpm: 20 }))).json();
  assert.equal(set.limits.startsPerMinute, 5);
  assert.equal(set.limits.gatewayRpm, 20);

  const url = (c: string) => `https://app.example.test/api/customers/${c}/block`;
  assert.equal((await block.PUT(req("PUT", viewer, {}, url("c-1")), p("c-1"))).status, 403);
  assert.equal((await block.PUT(req("PUT", admin, {}, url("bad id")), p("bad id"))).status, 400);
  const b = await block.PUT(req("PUT", admin, { reason: "spam" }, url("c-1")), p("c-1"));
  assert.equal(b.status, 200);
  const now = await (await list.GET(req("GET", viewer))).json();
  assert.deepEqual(now.blocked.map((x: { customer: string; reason: string }) => [x.customer, x.reason]), [["c-1", "spam"]]);
  assert.equal((await block.DELETE(req("DELETE", admin, undefined, url("c-1")), p("c-1"))).status, 200);
  assert.equal((await block.DELETE(req("DELETE", admin, undefined, url("c-1")), p("c-1"))).status, 404, "not blocked any more");
});


test("phase 2: the open-runs and daily model spend limits round-trip; usage per customer answers", async () => {
  const set = await (await list.PATCH(req("PATCH", admin, { maxOpenRuns: 3, dailyModelUsd: 2.555 }))).json();
  assert.equal(set.limits.maxOpenRuns, 3);
  assert.equal(set.limits.dailyModelUsd, 2.56, "dollars kept to the cent");
  assert.equal((await list.PATCH(req("PATCH", admin, { dailyModelUsd: 0 }))).status, 400);
  assert.equal((await list.PATCH(req("PATCH", admin, { maxOpenRuns: 1.5 }))).status, 400);
  const back = await (await list.PATCH(req("PATCH", admin, { maxOpenRuns: null, dailyModelUsd: null }))).json();
  assert.equal(back.limits.maxOpenRuns, back.defaults.maxOpenRuns);
  assert.equal(back.limits.dailyModelUsd, null);
  const u = await (await usage.GET(req("GET", viewer, undefined, "https://app.example.test/api/customers/usage?days=30"))).json();
  assert.equal(u.days, 30);
  assert.deepEqual(u.customers, []);
});

test("a key that requires a customer (FOL-168): set at creation or by PATCH; its runs without a customer are refused 400 customer_required; not for an A2A key", async () => {
  const keys = await import("../app/api/keys/route.ts");
  const keyPatch = await import("../app/api/keys/[id]/route.ts");
  const agentRun = await import("../app/api/workspaces/[workspace]/agents/[agent]/run/route.ts");
  fs.mkdirSync(path.join(process.env.FOLDRUN_DATA!, "acme", "workspaces", "desk", "agents", "w"), { recursive: true });
  fs.writeFileSync(path.join(process.env.FOLDRUN_DATA!, "acme", "workspaces", "desk", "agents", "w", "agent.md"), "---\nname: w\n---\n\nWrite.\n");
  const made = await (await keys.POST(req("POST", admin, { label: "partner app", role: "editor", requireCustomer: true }, "https://app.example.test/api/keys"))).json();
  assert.ok(made.key, JSON.stringify(made));
  const runAs = (key: string, body: Record<string, unknown>) =>
    agentRun.POST(req("POST", key, body, "https://app.example.test/api/workspaces/desk/agents/w/run"), { params: Promise.resolve({ workspace: "desk", agent: "w" }) });
  const bare = await runAs(made.key, { task: "x", test: true });
  assert.equal(bare.status, 400);
  const body = await bare.json();
  assert.equal(body.code, "customer_required");
  assert.equal((await runAs(made.key, { task: "x", test: true, customer: "c-1" })).status, 200, "with a customer it runs");
  assert.equal((await runAs(admin, { task: "x", test: true })).status, 200, "a key without the option is not held to it");

  const off = await keyPatch.PATCH(req("PATCH", admin, { requireCustomer: false }, `https://app.example.test/api/keys/${made.id}`), { params: Promise.resolve({ id: made.id }) });
  assert.equal(off.status, 200, await off.clone().text());
  assert.equal((await runAs(made.key, { task: "x", test: true })).status, 200, "turned off, runs without one go");
  assert.equal((await keyPatch.PATCH(req("PATCH", viewer, { requireCustomer: true }, `https://app.example.test/api/keys/${made.id}`), { params: Promise.resolve({ id: made.id }) })).status, 403);
  assert.equal((await keyPatch.PATCH(req("PATCH", admin, { requireCustomer: "yes" }, `https://app.example.test/api/keys/${made.id}`), { params: Promise.resolve({ id: made.id }) })).status, 400);
  assert.equal((await keys.POST(req("POST", admin, { label: "a2a", purpose: "a2a", workspace: "desk", flows: ["x"], requireCustomer: true }, "https://app.example.test/api/keys"))).status, 400);
  const listed = await (await keys.GET(req("GET", admin, undefined, "https://app.example.test/api/keys"))).json();
  assert.equal(listed.keys.find((k: { id: string }) => k.id === made.id).requireCustomer, undefined, "the list says it is off now");
});

test("a key that requires a customer keeps it when rotated; a PATCH with a bad models field changes nothing (Codex review)", async () => {
  const keys = await import("../app/api/keys/route.ts");
  const keyPatch = await import("../app/api/keys/[id]/route.ts");
  const rotate = await import("../app/api/keys/[id]/rotate/route.ts");
  const made = await (await keys.POST(req("POST", admin, { label: "partner app 2", role: "editor", requireCustomer: true }, "https://app.example.test/api/keys"))).json();
  const half = await keyPatch.PATCH(req("PATCH", admin, { requireCustomer: false, models: { sonnet: "nope" } }, `https://app.example.test/api/keys/${made.id}`), { params: Promise.resolve({ id: made.id }) });
  assert.equal(half.status, 400, "an API key has no model map");
  let listed = await (await keys.GET(req("GET", admin, undefined, "https://app.example.test/api/keys"))).json();
  assert.equal(listed.keys.find((k: { id: string }) => k.id === made.id).requireCustomer, true, "nothing was applied");
  const r = await rotate.POST(req("POST", admin, { grace: "0" }, `https://app.example.test/api/keys/${made.id}/rotate`), { params: Promise.resolve({ id: made.id }) });
  const rot = await r.json();
  assert.equal(r.status, 200, JSON.stringify(rot));
  listed = await (await keys.GET(req("GET", admin, undefined, "https://app.example.test/api/keys"))).json();
  assert.equal(listed.keys.find((k: { id: string }) => k.id === rot.id).requireCustomer, true, "the replacement still requires one");
});
