// With the revision journal on, the history API and /restore run on revisions
// (FOL-126 phase 3b): the same response shapes, and a restore is a NEW revision
// that records what it restored from.
//
//   node --import ./tests/register.mjs --test tests/restore-revisions.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-restore-rev-"));
process.env.FOLDRUN_DATA = root;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
const { NextRequest } = await import("next/server");
const restoreRoute = await import("../app/api/workspaces/[workspace]/restore/route.ts");
const historyRoute = await import("../app/api/workspaces/[workspace]/history/route.ts");
const sourceRoute = await import("../app/api/workspaces/[workspace]/source/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { deployWorkspace } = await import("@/lib/deploy");
const wr = await import("@/lib/workspace-revisions");
const { fsBlobStore, bounded } = await import("@/lib/blob-store");
const { localRevisionStore } = await import("@/lib/revision-store");
const { headsOf } = await import("@/lib/publish");

const { key } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
const auth = { authorization: `Bearer ${key}`, "content-type": "application/json" };
const ctx = { params: Promise.resolve({ workspace: "desk" }) };
const AGENTS = "---\nname: desk\n---\n\nA desk.\n";
const agent = (body: string) => `---\nname: writer\ndescription: writes\n---\n\n${body}\n`;
const deps = { blobs: bounded(fsBlobStore(path.join(root, ".objects")), { backoffMs: 1 }), revisions: localRevisionStore(path.join(root, ".revisions")) };

let reads = true;
wr.setRevisionBackend(deps, { journal: () => true, read: () => reads });
test.after(() => {
  wr.setRevisionBackend(null);
  wr.resetJournalForTests();
});

const deploy = (body: string, message: string) => {
  const r = deployWorkspace("acme", "desk", [{ path: "AGENTS.md", content: AGENTS }, { path: "agents/writer/agent.md", content: agent(body) }], { by: "a@acme.test", message });
  assert.ok(r.applied, JSON.stringify(r.issues));
};
const history = async (q = "") => (await (await historyRoute.GET(new NextRequest(`http://x/api/workspaces/desk/history${q}`, { headers: auth }), ctx)).json()) as { revisions: { id: string; message: string; paths: string[] }[] };
const restore = (body: object) => restoreRoute.POST(new NextRequest("http://x/api/workspaces/desk/restore", { method: "POST", headers: auth, body: JSON.stringify(body) }), ctx);

test("the history API lists revisions in the old shape, and one revision with its diff", async () => {
  deploy("one", "v1");
  await wr.flushRevisions();
  deploy("two", "v2");
  await wr.flushRevisions();
  const { revisions } = await history();
  assert.deepEqual(revisions.slice(0, 2).map((r) => r.message), ["v2", "v1"]);
  assert.ok(revisions[0].paths.includes("agents/writer/agent.md"));
  assert.ok(revisions[0].id.startsWith("rev_"), "the id is the revision's");
  const one = (await (await historyRoute.GET(new NextRequest(`http://x/api/workspaces/desk/history?id=${revisions[0].id}`, { headers: auth }), ctx)).json()) as { files: { path: string; diff: { kind: string; text: string }[] }[] };
  const f = one.files.find((x) => x.path === "agents/writer/agent.md")!;
  assert.ok(f.diff.some((d) => d.kind === "add" && d.text === "two"));
});

test("restore: a dry run, then the restore is a NEW revision at the old content with restoredFrom, history kept", async () => {
  const before = (await history()).revisions;
  const v1 = before.find((r) => r.message === "v1")!;
  const dry = (await (await restore({ to: v1.id, dryRun: true })).json()) as { to: { id: string }; updated: string[] };
  assert.equal(dry.to.id, v1.id);
  assert.deepEqual(dry.updated, ["agents/writer/agent.md"]);
  const res = await restore({ to: v1.id, confirm: "desk" });
  assert.equal(res.status, 200);
  const done = (await res.json()) as { applied: boolean; main: string; from: string };
  assert.equal(done.applied, true);
  const after = (await history()).revisions;
  assert.equal(after.length, before.length + 1, "history is kept, one more revision");
  assert.equal(after[0].id, done.main, "main is the revision the restore made, committed before the answer");
  assert.match(after[0].message, /^restored to /);
  const heads = await headsOf(deps, { tenant: "acme", workspace: "desk" });
  assert.equal(heads.workspace?.restoredFrom, v1.id);
  assert.equal(fs.readFileSync(path.join(root, "acme/workspaces/desk/agents/writer/agent.md"), "utf8"), agent("one"));
});

test("/source reads through the head when reads are on, and from the folder when they are off", async () => {
  const get = async () => ((await (await sourceRoute.GET(new NextRequest("http://x/api/workspaces/desk/source?path=agents/writer/agent.md", { headers: auth }), ctx)).json()) as { content: string }).content;
  await wr.flushRevisions();
  fs.writeFileSync(path.join(root, "acme/workspaces/desk/agents/writer/agent.md"), agent("behind the head"));
  reads = true;
  assert.equal(await get(), agent("one"), "served from the head");
  reads = false;
  assert.equal(await get(), agent("behind the head"), "reads off: the folder");
});

test("a time resolves against revisions as it did against local history", async () => {
  const dry = await restore({ to: "0m", dryRun: true });
  assert.equal(dry.status, 200);
});
