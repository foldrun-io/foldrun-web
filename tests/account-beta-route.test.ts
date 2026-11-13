// GET/PUT /api/account/beta — the account joins or leaves the beta (13 Nov
// 2026): who may, the beta flags it answers with, and that a beta flag
// follows.
//
//   node --import ./tests/register.mjs --test tests/account-beta-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-account-beta-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { flagOn, resetFlagCache } = await import("@/platform/flags.ts");
const route = (await import("../app/api/account/beta/route.ts")) as unknown as {
  GET: (req: InstanceType<typeof NextRequest>) => Promise<Response>;
  PUT: (req: InstanceType<typeof NextRequest>) => Promise<Response>;
};

const T = "acme";
fs.mkdirSync(path.join(DATA, T, "workspaces", "desk"), { recursive: true });
fs.writeFileSync(path.join(DATA, T, "workspaces", "desk", "AGENTS.md"), "---\nname: desk\n---\n");
const { key: admin } = await createApiKey(T, "admin", "o@acme.test", undefined, "admin");
const { key: editor } = await createApiKey(T, "editor", "o@acme.test", undefined, "editor");
const { key: viewer } = await createApiKey(T, "viewer", "o@acme.test", undefined, "viewer");
const { key: scopedAdmin } = await createApiKey(T, "scoped", "o@acme.test", undefined, "admin", ["desk"]);

const url = "http://localhost/api/account/beta";
const get = (key: string) => route.GET(new NextRequest(url, { headers: { authorization: `Bearer ${key}` } }));
const put = (key: string, body: unknown) =>
  route.PUT(new NextRequest(url, { method: "PUT", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }));

test("every role reads it: out of the beta, with the beta flags as they stand", async () => {
  for (const k of [admin, editor, viewer, scopedAdmin]) {
    const r = await get(k);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.beta, false);
    assert.deepEqual(b.flags.map((f: { name: string; on: boolean }) => [f.name, f.on]), [["example-beta", false]], "only flags marked beta");
  }
});

test("an admin of every workspace joins and leaves; a beta flag follows; changed says whether it did", async () => {
  let b = await (await put(admin, { beta: true })).json();
  assert.deepEqual([b.beta, b.changed, b.flags[0].on, b.flags[0].source], [true, true, true, "beta"]);
  resetFlagCache();
  assert.equal(await flagOn(T, "example-beta"), true);
  assert.equal((await (await put(admin, { beta: true })).json()).changed, false, "again: no change");
  b = await (await put(admin, { beta: false })).json();
  assert.deepEqual([b.beta, b.changed, b.flags[0].on], [false, true, false]);
});

test("not an admin, or an admin of only some workspaces: refused, nothing changes", async () => {
  for (const [k, status] of [[editor, 403], [viewer, 403], [scopedAdmin, 403]] as const) {
    const r = await put(k, { beta: true });
    assert.equal(r.status, status);
  }
  assert.equal((await (await get(admin)).json()).beta, false);
});

test("a body without a boolean beta is a 400 that says what to send", async () => {
  for (const body of [{}, { beta: "yes" }, null]) {
    const r = await put(admin, body);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /\{ beta: true \}/);
  }
});
