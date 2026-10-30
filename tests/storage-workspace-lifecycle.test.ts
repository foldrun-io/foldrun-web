// The file store's routes and the workspace it belongs to (30 Oct 2026).
//
// The store is kept by workspace NAME beside the workspace folder. So any
// safe name took writes (a fresh quota per invented name), a delete left the
// files downloadable and their public links serving, and a rename left them
// behind for whoever took the old name next. And upload-url signed a PUT of
// any size, which registering then recorded at whatever size it was told.
//
//   node --import ./tests/register.mjs --test tests/storage-workspace-lifecycle.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-storage-lifecycle-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_STORAGE_DRIVER;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
const storage = (await import("../app/api/workspaces/[workspace]/storage/route.ts")) as unknown as Record<"GET" | "POST" | "PUT" | "DELETE", Handler>;
const uploadUrl = (await import("../app/api/workspaces/[workspace]/storage/upload-url/route.ts")) as unknown as { POST: Handler };
const download = (await import("../app/api/workspaces/[workspace]/storage/download/route.ts")) as unknown as { GET: Handler };
const wsRoute = (await import("../app/api/workspaces/[workspace]/route.ts")) as unknown as { DELETE: Handler; PATCH: Handler };
const { createShare, resolveShare } = await import("@/platform/shares");
const { blobPath, listStorage } = await import("@/lib/storage");

const TENANT = "acme";
const mk = (name: string) => {
  const dir = path.join(DATA, TENANT, "workspaces", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `---\nname: ${name}\n---\n`);
};
mk("desk");

const { key: admin } = await createApiKey(TENANT, "admin", "owner@acme.test", undefined, "admin");
const req = (url: string, method = "GET", body?: unknown, raw?: Buffer) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      authorization: `Bearer ${admin}`,
      "content-type": raw ? "application/octet-stream" : "application/json",
      ...(raw ? { "content-length": String(raw.length) } : {}),
    },
    ...(raw ? { body: new Uint8Array(raw) } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const ctx = (workspace: string) => ({ params: Promise.resolve({ workspace }) });
const put = (ws: string, rel: string, bytes: string) =>
  storage.PUT(req(`/api/workspaces/${ws}/storage?path=${encodeURIComponent(rel)}`, "PUT", undefined, Buffer.from(bytes)), ctx(ws));

test("every storage route answers 404 for a workspace that does not exist, and makes no store", async () => {
  const ghost = "invented-1";
  assert.equal((await storage.GET(req(`/api/workspaces/${ghost}/storage`), ctx(ghost))).status, 404);
  assert.equal((await put(ghost, "a.bin", "x")).status, 404);
  assert.equal((await storage.POST(req(`/api/workspaces/${ghost}/storage`, "POST", { path: "a.bin", sha: "a".repeat(64), size: 1 }), ctx(ghost))).status, 404);
  assert.equal((await uploadUrl.POST(req(`/api/workspaces/${ghost}/storage/upload-url`, "POST", { path: "a.bin", sha: "a".repeat(64), size: 1 }), ctx(ghost))).status, 404);
  assert.equal((await download.GET(req(`/api/workspaces/${ghost}/storage/download?path=a.bin`), ctx(ghost))).status, 404);
  assert.equal(fs.existsSync(path.join(DATA, TENANT, "storage", ghost)), false);
});

test("upload-url takes the length when given, and refuses one over the limit before anything is signed", async () => {
  const ask = (body: unknown) => uploadUrl.POST(req("/api/workspaces/desk/storage/upload-url", "POST", body), ctx("desk"));
  // An older CLI sends no size: still answered (registerUpload measures the real object).
  assert.equal((await ask({ path: "a.bin", sha: "a".repeat(64) })).status, 200, "no size is still served");
  assert.equal((await ask({ path: "a.bin", sha: "a".repeat(64), size: "12" })).status, 400, "size that is not a number");
  process.env.FOLDRUN_STORAGE_MAX_MB = "0.001";
  try {
    const r = await ask({ path: "a.bin", sha: "a".repeat(64), size: 4096 });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /the limit is/);
  } finally {
    delete process.env.FOLDRUN_STORAGE_MAX_MB;
  }
  // The fs driver has no bucket: url null, the client PUTs here instead.
  assert.deepEqual(await (await ask({ path: "a.bin", sha: "a".repeat(64), size: 10 })).json(), { url: null });
});

test("a registered upload is recorded at the size the store holds, not the size claimed", async () => {
  const bytes = Buffer.alloc(321, 7);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  fs.mkdirSync(path.dirname(blobPath(TENANT, "desk", sha)), { recursive: true });
  fs.writeFileSync(blobPath(TENANT, "desk", sha), bytes);
  const r = await storage.POST(req("/api/workspaces/desk/storage", "POST", { path: "parked.bin", sha, size: 1 }), ctx("desk"));
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).file.size, 321);
});

test("a download streams the bytes, with their length", async () => {
  assert.equal((await put("desk", "notes.txt", "hello there")).status, 200);
  const r = await download.GET(req("/api/workspaces/desk/storage/download?path=notes.txt"), ctx("desk"));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-length"), "11");
  assert.equal(await r.text(), "hello there");
});

test("deleting a workspace deletes its files and stops its public links; the name comes back empty", async () => {
  mk("doomed");
  assert.equal((await put("doomed", "report.pdf", "%PDF doomed")).status, 200);
  const share = await createShare(TENANT, "doomed", "storage/report.pdf", { ttlDays: null });
  assert.ok(await resolveShare(share.token));

  const r = await wsRoute.DELETE(req("/api/workspaces/doomed", "DELETE"), ctx("doomed"));
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(await resolveShare(share.token), null, "the public link stopped");
  assert.equal(fs.existsSync(path.join(DATA, TENANT, "storage", "doomed")), false, "the store went with it");

  mk("doomed");
  assert.deepEqual(listStorage(TENANT, "doomed"), [], "a new workspace of the name inherits nothing");
  assert.equal(await resolveShare(share.token), null, "nor the old links");
  assert.equal((await wsRoute.DELETE(req("/api/workspaces/never-was", "DELETE"), ctx("never-was"))).status, 404);
});

test("renaming a workspace takes its files and links with it", async () => {
  mk("before");
  assert.equal((await put("before", "cover.jpg", "JPEG")).status, 200);
  const share = await createShare(TENANT, "before", "storage/cover.jpg");

  const r = await wsRoute.PATCH(req("/api/workspaces/before", "PATCH", { name: "after" }), ctx("before"));
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(listStorage(TENANT, "after").map((f) => f.path), ["cover.jpg"]);
  const hit = await resolveShare(share.token);
  assert.equal(hit?.share.workspace, "after");
  assert.equal((await hit!.read())?.toString(), "JPEG");

  mk("before");
  assert.deepEqual(listStorage(TENANT, "before"), [], "the old name keeps nothing");
});
