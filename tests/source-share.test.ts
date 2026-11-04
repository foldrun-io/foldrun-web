// POST /api/workspaces/<ws>/source/share — "Move to shared" in one call,
// for the dashboard and `foldrun source share` alike (5 Nov 2026).
//
//   node --import ./tests/register.mjs --test tests/source-share.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-share-"));
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_DEV_NO_AUTH;

const { createApiKey } = await import("../server/auth.ts");
const { createUser } = await import("../server/users.ts");
const route = await import("../app/api/workspaces/[workspace]/source/share/route.ts");

await createUser("owner@share.test", "a long and unusual passphrase 42!", "share-co");
const ws = path.join(process.env.FOLDRUN_DATA!, "share-co", "workspaces", "desk");
const lib = path.join(process.env.FOLDRUN_DATA!, "share-co", "library");
const put = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
  fs.writeFileSync(path.join(ws, rel), text);
};
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
const { key: admin } = await createApiKey("share-co", "ops", "owner@share.test", undefined, "admin", null);
const { key: scoped } = await createApiKey("share-co", "desk only", "owner@share.test", undefined, "admin", ["desk"]);
const { key: viewer } = await createApiKey("share-co", "look", "owner@share.test", undefined, "viewer", null);

const call = (key: string, body: unknown) =>
  route.POST(
    new NextRequest("http://localhost:3900/api/workspaces/desk/source/share", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workspace: "desk" }) },
  );

test("a skill folder moves whole, and the answer names every file", async () => {
  put("skills/tone/SKILL.md", "---\nname: tone\ndescription: x\n---\nBe kind.\n");
  put("skills/tone/examples.md", "# e\n");
  const dry = await call(admin, { path: "skills/tone/SKILL.md", dryRun: true });
  assert.equal(dry.status, 200, await dry.clone().text());
  assert.equal((await dry.json()).moved, false);
  assert.ok(fs.existsSync(path.join(ws, "skills/tone/SKILL.md")), "a dry run writes nothing");
  const r = await call(admin, { path: "skills/tone/SKILL.md" });
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.equal(body.unit, "skills/tone");
  assert.deepEqual(body.files.map((f: { to: string }) => f.to), ["tone/SKILL.md", "tone/examples.md"]);
  assert.ok(fs.existsSync(path.join(lib, "skills/tone/examples.md")));
  assert.equal(fs.existsSync(path.join(ws, "skills/tone")), false);
});

test("a folder with a file the library cannot hold is refused 409 and nothing moves", async () => {
  put("skills/art/SKILL.md", "---\nname: art\ndescription: x\n---\nDraw.\n");
  put("skills/art/logo.png", "\x89PNG");
  const r = await call(admin, { path: "skills/art" });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /logo\.png/);
  assert.ok(fs.existsSync(path.join(ws, "skills/art/SKILL.md")));
});

test("a scoped key and a viewer are refused; a bad body is a 400", async () => {
  put("knowledge/a.md", "a\n");
  assert.equal((await call(scoped, { path: "knowledge/a.md" })).status, 403, "the library is every workspace's");
  assert.equal((await call(viewer, { path: "knowledge/a.md" })).status, 403);
  assert.equal((await call(admin, {})).status, 400);
  assert.equal((await call(admin, { path: "knowledge/a.md", overwrite: "yes" })).status, 400);
  assert.equal((await call(admin, { path: "knowledge/missing.md" })).status, 404);
  assert.ok(fs.existsSync(path.join(ws, "knowledge/a.md")));
});
