// POST …/snapshots — a folder sent for an agent on foldrun to work on (Part B3).
// The route: who may send, the size checks before the body is read, and the
// server's refusals whatever the client checked. Storage itself is tested in
// foldrun-platform tests/snapshots.test.ts.
//
//   node --import ./tests/register.mjs --test tests/snapshots-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-snapshots-route-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { packSnapshot } = await import("@/lib/snapshot-archive");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
const route = (await import("../app/api/workspaces/[workspace]/snapshots/route.ts")) as unknown as { POST: Handler };

const TENANT = "acme";
for (const ws of ["desk", "other"]) {
  const p = path.join(DATA, TENANT, "workspaces", ws, "AGENTS.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `---\nname: ${ws}\n---\n`);
}
const { key: editor } = await createApiKey(TENANT, "editor", "owner@acme.test", undefined, "editor");
const { key: viewer } = await createApiKey(TENANT, "viewer", "owner@acme.test", undefined, "viewer");
const { key: otherOnly } = await createApiKey(TENANT, "other-only", "owner@acme.test", undefined, "editor", ["other"]);

const post = (ws: string, key: string, body: Uint8Array, headers: Record<string, string> = {}) =>
  route.POST(
    new NextRequest(`http://localhost/api/workspaces/${ws}/snapshots`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/gzip", "content-length": String(body.length), ...headers },
      body: body as Uint8Array<ArrayBuffer>,
    }),
    { params: Promise.resolve({ workspace: ws }) },
  );
const f = (p: string, text: string) => ({ path: p, mode: 0o644, content: Buffer.from(text) });
const folder = packSnapshot([f("src/index.ts", "export const x = 1;\n"), f("README.md", "hi\n")]);

test("an editor sends a folder: 201 with its id; the same folder again is 200, reused", async () => {
  const r = await post("desk", editor, folder.archive);
  assert.equal(r.status, 201, await r.clone().text());
  const body = await r.json();
  assert.equal(body.snapshotId, folder.sha256);
  assert.equal(body.files, 2);
  assert.equal(body.reused, false);
  assert.ok(Date.parse(body.expiresAt) > Date.now());
  const again = await post("desk", editor, folder.archive);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).reused, true);
});

test("who may not: a viewer, a key held to another workspace; an unknown workspace is 404", async () => {
  assert.equal((await post("desk", viewer, folder.archive)).status, 403);
  assert.equal((await post("desk", otherOnly, folder.archive)).status, 403);
  assert.equal((await post("nosuch", editor, folder.archive)).status, 404);
  assert.equal((await post("desk", "fr_not_a_key", folder.archive)).status, 401);
});

test("refused before the body is read: no length (411), too large a length (413), an empty body (400)", async () => {
  const noLen = await route.POST(
    new NextRequest("http://localhost/api/workspaces/desk/snapshots", { method: "POST", headers: { authorization: `Bearer ${editor}` }, body: new ReadableStream(), duplex: "half" } as never),
    { params: Promise.resolve({ workspace: "desk" }) },
  );
  assert.equal(noLen.status, 411);
  assert.equal((await post("desk", editor, folder.archive, { "content-length": String(51 * 1024 * 1024) })).status, 413);
  assert.equal((await post("desk", editor, new Uint8Array(0))).status, 400);
});

test("the server's own checks: not an archive, and a secret (named by file and line, never echoed) — 422", async () => {
  const junk = await post("desk", editor, Buffer.from("this is not a tarball"));
  assert.equal(junk.status, 422);
  assert.match((await junk.json()).error, /not a gzip/);
  const key = ["sk", "live", "abcdefghijklmnopqrstuvwxyzAB"].join("_");
  const leaky = packSnapshot([f("config.ts", `export const k = "${key}";\n`)]);
  const r = await post("desk", editor, leaky.archive);
  assert.equal(r.status, 422);
  const text = await r.text();
  assert.match(text, /config\.ts:1/);
  assert.ok(!text.includes(key), "the value is never sent back");
});
