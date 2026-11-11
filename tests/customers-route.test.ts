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
