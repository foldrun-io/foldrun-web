// GET/PUT /api/account/agents-md — the account's own AGENTS.md, whole (cloudhost,
// 11 Nov 2026): who may read and write it, the deploy's checks, ifMatch.
//
//   node --import ./tests/register.mjs --test tests/account-agents-md-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-account-agents-md-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const route = (await import("../app/api/account/agents-md/route.ts")) as unknown as {
  GET: (req: InstanceType<typeof NextRequest>) => Promise<Response>;
  PUT: (req: InstanceType<typeof NextRequest>) => Promise<Response>;
};
const account = (await import("../app/api/account/route.ts")) as unknown as { GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };

const T = "acme";
fs.mkdirSync(path.join(DATA, T, "workspaces", "desk"), { recursive: true });
fs.writeFileSync(path.join(DATA, T, "workspaces", "desk", "AGENTS.md"), "---\nname: desk\n---\n");
const { key: admin } = await createApiKey(T, "admin", "o@acme.test", undefined, "admin");
const { key: editor } = await createApiKey(T, "editor", "o@acme.test", undefined, "editor");
const { key: viewer } = await createApiKey(T, "viewer", "o@acme.test", undefined, "viewer");
const { key: scopedAdmin } = await createApiKey(T, "scoped", "o@acme.test", undefined, "admin", ["desk"]);

const url = "http://localhost/api/account/agents-md";
const get = (key: string) => route.GET(new NextRequest(url, { headers: { authorization: `Bearer ${key}` } }));
const put = (key: string, body: unknown) =>
  route.PUT(new NextRequest(url, { method: "PUT", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
const onDisk = () => (fs.existsSync(path.join(DATA, T, "AGENTS.md")) ? fs.readFileSync(path.join(DATA, T, "AGENTS.md"), "utf8") : null);

const GOOD = "---\ntimezone: Asia/Tehran\n---\n\n# Shared context\n\nEvery agent here answers in Persian: «می‌شود».\n";

test("an admin of every workspace writes the whole file; GET reads it back; the settings route sees its keys", async () => {
  const empty = await (await get(admin)).json();
  assert.deepEqual(empty, { content: "", sha256: null, exists: false });
  const r = await put(admin, { content: GOOD, ifMatch: null });
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(onDisk(), GOOD);
  const back = await (await get(viewer)).json();
  assert.equal(back.content, GOOD, "an unscoped viewer may read it");
  assert.equal(back.sha256, body.sha256);
  const defaults = await (await account.GET(new NextRequest("http://localhost/api/account", { headers: { authorization: `Bearer ${admin}` } }))).json();
  assert.equal(defaults.defaults.timezone, "Asia/Tehran", "PATCH /api/account's view reads the same file");
  const again = await (await put(admin, { content: GOOD })).json();
  assert.equal(again.unchanged, true);
});

test("who may not: an editor, a viewer, anyone scoped to some workspaces", async () => {
  assert.equal((await put(editor, { content: GOOD })).status, 403);
  assert.equal((await put(viewer, { content: GOOD })).status, 403);
  assert.equal((await put(scopedAdmin, { content: GOOD })).status, 403, "it is every workspace's");
  assert.equal((await get(scopedAdmin)).status, 403, "and it can name notify and telemetry targets for all of them");
});

test("a file a deploy would refuse writes nothing (422 with the issues); a stale ifMatch is a 409", async () => {
  const before = onDisk();
  const bad = await put(admin, { content: "---\ntimezone: [not, a, zone\n---\nbroken\n" });
  assert.equal(bad.status, 422);
  const b = await bad.json();
  assert.ok(b.issues.length >= 1);
  assert.match(b.error, /nothing was written — .+/, "the reasons are in the message the editor shows");
  assert.equal(onDisk(), before, "nothing written");
  assert.equal((await put(admin, { content: GOOD + "x\n", ifMatch: "0".repeat(64) })).status, 409);
  assert.equal((await put(admin, { content: GOOD + "x\n", ifMatch: null })).status, 409, "null means you saw no file; there is one");
  assert.equal((await put(admin, { content: 5 })).status, 400);
  assert.equal(onDisk(), before);
});
