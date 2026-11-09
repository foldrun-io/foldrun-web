// Deleting or renaming a workspace through the API takes its revision history
// with it (FOL-126 fixes, 8 Nov 2026): a new workspace given the deleted name
// starts empty, and a renamed one keeps its history under the new name.
//
//   node --import ./tests/register.mjs --test tests/workspace-history-lifecycle.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-ws-life-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
delete process.env.FOLDRUN_STORAGE_DRIVER;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const { fsBlobStore } = await import("../../foldrun-core/src/blob-store.ts");
const { localRevisionStore } = await import("../../foldrun-core/src/revision-store.ts");
const { writeWorkspaceFile } = await import("../../foldrun-core/src/store.ts");
const { setRevisionBackend, flushRevisions, readAtHead } = await import("../../foldrun-core/src/workspace-revisions.ts");
const { headsOf } = await import("../../foldrun-core/src/publish.ts");
type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ workspace: string }> }) => Promise<Response>;
const route = (await import("../app/api/workspaces/[workspace]/route.ts")) as unknown as { PATCH: Handler; DELETE: Handler };

const data = process.env.FOLDRUN_DATA!;
const deps = { blobs: fsBlobStore(path.join(data, ".objects")), revisions: localRevisionStore(path.join(data, ".revisions")) };
setRevisionBackend(deps, { journal: () => true, read: () => true });
const { key } = await createApiKey("acme", "ops", "admin@acme.test", undefined, "admin", null);
const call = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://x${url}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = (workspace: string) => ({ params: Promise.resolve({ workspace }) });
const headOf = (workspace: string) => headsOf(deps, { tenant: "acme", workspace });

async function make(ws: string, file: string, body: string) {
  const dir = path.join(data, "acme", "workspaces", ws);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENTS.md"), `---\nname: ${ws}\n---\n`);
  writeWorkspaceFile("acme", ws, file, body, { by: "test" });
  await flushRevisions({ tenant: "acme", workspace: ws });
}

test("DELETE drops the history: a new workspace of the same name starts empty", async () => {
  await make("sales", "memory/private.md", "the old workspace's file\n");
  assert.ok((await headOf("sales")).workspace);
  const res = await route.DELETE(call("/api/workspaces/sales", "DELETE"), ctx("sales"));
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await headOf("sales")).workspace, null);
  assert.equal(await readAtHead("acme", "sales", "memory/private.md"), null);
  await make("sales", "memory/fresh.md", "fresh\n");
  assert.equal(await readAtHead("acme", "sales", "memory/private.md"), null, "the new workspace cannot read the old one's file from its head");
  assert.equal((await deps.revisions.revisions({ tenant: "acme", workspace: "sales" })).length, 1);
});

test("PATCH rename moves the history to the new name and leaves the old name empty", async () => {
  await make("ops", "memory/ops.md", "ops\n");
  const was = (await headOf("ops")).workspace!.id;
  const res = await route.PATCH(call("/api/workspaces/ops", "PATCH", { name: "platform" }), ctx("ops"));
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal((await headOf("platform")).workspace?.id, was);
  assert.equal((await headOf("ops")).workspace, null);
  assert.equal((await readAtHead("acme", "platform", "memory/ops.md"))?.toString(), "ops\n");
  await make("ops", "memory/new.md", "n\n");
  assert.equal(await readAtHead("acme", "ops", "memory/ops.md"), null);
});

test("PATCH rename onto a name that is taken is a 409 and moves nothing", async () => {
  await make("a1", "memory/a.md", "a\n");
  await make("b1", "memory/b.md", "b\n");
  const idB = (await headOf("b1")).workspace!.id;
  const res = await route.PATCH(call("/api/workspaces/a1", "PATCH", { name: "b1" }), ctx("a1"));
  assert.equal(res.status, 409);
  assert.equal((await headOf("b1")).workspace?.id, idB);
  assert.ok((await headOf("a1")).workspace);
});
