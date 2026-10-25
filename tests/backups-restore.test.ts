// Backups and restore: the account's snapshot list, a workspace's source
// restored to a point in its history (dry run with diffs, refused without
// the name typed back, then done — and undoable), and a restore request.
//
//   node --import ./tests/register.mjs --test tests/backups-restore.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-backups-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
const { NextRequest } = await import("next/server");
const restoreRoute = await import("../app/api/workspaces/[workspace]/restore/route.ts");
const backupsRoute = await import("../app/api/account/backups/route.ts");
const requestsRoute = await import("../app/api/account/backups/requests/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { deployWorkspace } = await import("@/lib/deploy");
const { recordBackup } = await import("@/platform/backups");
const { headRevision } = await import("@/lib/history");
// The newest revision with a snapshot — what a restore reaches as "now".
const headSha = (t: string, w: string) => headRevision(t, w)?.id ?? null;

const { key } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
const { key: viewer } = await createApiKey("acme", "ro", "ro@acme.test", undefined, "viewer", null);
const auth = (k = key) => ({ authorization: `Bearer ${k}`, "content-type": "application/json" });
const restore = (body: object, k = key) =>
  restoreRoute.POST(new NextRequest("http://x/api/workspaces/desk/restore", { method: "POST", headers: auth(k), body: JSON.stringify(body) }), {
    params: Promise.resolve({ workspace: "desk" }),
  });

const ws = path.join(process.env.FOLDRUN_DATA, "acme/workspaces/desk");
const AGENTS = "---\nname: desk\n---\n\nA desk.\n";
const agent = (body: string) => `---\nname: writer\ndescription: writes\n---\n\n${body}\n`;
const FLOW = "---\nname: publish\ntrigger: manual\n---\n\n1. [[writer]] — write it\n";

// Two points in history: v1 (writer says "one", a flow), v2 (writer says "two", no flow, a new knowledge file).
const v1 = deployWorkspace("acme", "desk", [
  { path: "AGENTS.md", content: AGENTS },
  { path: "agents/writer/agent.md", content: agent("one") },
  { path: "flows/publish.md", content: FLOW },
], { by: "a@acme.test", message: "v1" });
assert.ok(v1.applied, JSON.stringify(v1.issues));
const sha1 = headSha("acme", "desk")!;
fs.mkdirSync(path.join(ws, "state"), { recursive: true });
fs.writeFileSync(path.join(ws, "state/ledger.csv"), "a,b\n1,2\n");
const v2 = deployWorkspace("acme", "desk", [
  { path: "AGENTS.md", content: AGENTS },
  { path: "agents/writer/agent.md", content: agent("two") },
  { path: "knowledge/new.md", content: "---\ntype: note\n---\n\n# new\n" },
], { by: "a@acme.test", message: "v2" });
assert.ok(v2.applied, JSON.stringify(v2.issues));
const sha2 = headSha("acme", "desk")!;

test("a dry run names every change with a diff, and writes nothing", async () => {
  const res = await restore({ to: sha1, dryRun: true });
  assert.equal(res.status, 200);
  const plan = await res.json();
  assert.equal(plan.dryRun, true);
  assert.equal(plan.to.sha, sha1);
  assert.equal(plan.to.id, sha1, "the revision's id, under both names");
  assert.equal(plan.from, sha2);
  assert.deepEqual(plan.updated, ["agents/writer/agent.md"]);
  assert.deepEqual(plan.added, ["flows/publish.md"]);
  // knowledge/index.md is generated beside the knowledge v2 brought; v1 had neither.
  assert.deepEqual(plan.removed, ["knowledge/index.md", "knowledge/new.md"]);
  const diff = plan.files.find((f: { path: string }) => f.path === "agents/writer/agent.md").diff;
  assert.ok(diff.some((d: { kind: string; text: string }) => d.kind === "add" && d.text === "one"));
  assert.ok(diff.some((d: { kind: string; text: string }) => d.kind === "del" && d.text === "two"));
  assert.equal(fs.readFileSync(path.join(ws, "agents/writer/agent.md"), "utf8"), agent("two"));
  assert.equal(headSha("acme", "desk"), sha2);
});

test("a time resolves to the last revision at or before it; nothing before the first is a 404", async () => {
  const later = await (await restore({ to: new Date(Date.now() + 60_000).toISOString(), dryRun: true })).json();
  assert.equal(later.to.sha, sha2);
  assert.equal((await restore({ to: "2001-01-01", dryRun: true })).status, 404);
  assert.equal((await restore({ to: "--all", dryRun: true })).status, 400);
  assert.equal((await restore({ dryRun: true })).status, 400);
});

test("without the workspace's name typed back, the restore is refused and nothing changes", async () => {
  const res = await restore({ to: sha1 });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /confirm/);
  assert.equal((await restore({ to: sha1, confirm: "other" })).status, 400);
  assert.equal(headSha("acme", "desk"), sha2);
});

test("a viewer cannot restore", async () => {
  assert.equal((await restore({ to: sha1, dryRun: true }, viewer)).status, 403);
});

test("the restore: files back as they were, state/ untouched, a new revision — and undoable", async () => {
  const dry = await (await restore({ to: sha1, dryRun: true })).json();
  const res = await restore({ to: sha1, confirm: "desk", expectRemoved: dry.removed });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.applied, true);
  assert.equal(body.from, sha2);
  assert.notEqual(body.main, sha1, "a restore is a new revision, not a reset");
  assert.equal(fs.readFileSync(path.join(ws, "agents/writer/agent.md"), "utf8"), agent("one"));
  assert.ok(fs.existsSync(path.join(ws, "flows/publish.md")));
  assert.ok(!fs.existsSync(path.join(ws, "knowledge/new.md")));
  assert.equal(fs.readFileSync(path.join(ws, "state/ledger.csv"), "utf8"), "a,b\n1,2\n", "state/ is never touched");

  const again = await (await restore({ to: sha1, confirm: "desk" })).json();
  assert.equal(again.noop, true);

  const undo = await restore({ to: body.from, confirm: "desk" });
  assert.equal(undo.status, 200);
  assert.equal(fs.readFileSync(path.join(ws, "agents/writer/agent.md"), "utf8"), agent("two"));
});

test("a removal the dry run did not show refuses the restore", async () => {
  fs.writeFileSync(path.join(ws, "knowledge/added-meanwhile.md"), "---\ntype: note\n---\n\n# hi\n");
  const res = await restore({ to: sha1, confirm: "desk", expectRemoved: ["knowledge/index.md", "knowledge/new.md"] });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.deepEqual(body.unexpectedRemovals, ["knowledge/added-meanwhile.md"]);
  assert.ok(fs.existsSync(path.join(ws, "knowledge/added-meanwhile.md")));
});

test("a restore leaves what an agent wrote into its own folder — history never held it", async () => {
  // a browser profile and a download, written at run time, never source
  fs.mkdirSync(path.join(ws, "agents/writer/.config/chrome"), { recursive: true });
  fs.writeFileSync(path.join(ws, "agents/writer/.config/chrome/settings.dat"), Buffer.from([0, 1, 2, 255]));
  fs.writeFileSync(path.join(ws, "agents/writer/contract.pdf"), Buffer.from("%PDF-1.7\n\xff\xfe binary"));
  const dry = await (await restore({ to: sha1, dryRun: true })).json();
  assert.ok(!dry.removed.some((p: string) => p.includes("contract.pdf") || p.includes(".config")), JSON.stringify(dry.removed));
  const res = await restore({ to: sha1, confirm: "desk", expectRemoved: dry.removed });
  assert.equal(res.status, 200);
  assert.ok(fs.existsSync(path.join(ws, "agents/writer/contract.pdf")), "the download is still there");
  assert.deepEqual([...fs.readFileSync(path.join(ws, "agents/writer/.config/chrome/settings.dat"))], [0, 1, 2, 255], "byte for byte");
});

test("backups: the account sees the snapshots it is in, the policy, and its workspaces", async () => {
  await recordBackup({ at: "2026-09-30T17:30:00Z", archive: "foldrun-data-20261001-0330.tar.gz", accounts: ["acme"], kinds: ["files", "database", "keys"], verified: true, offsite: "r2", bytes: 1234 });
  await recordBackup({ at: "2026-09-30T17:30:00Z", archive: "foldrun-data-other.tar.gz", accounts: ["someone-else"] });
  await recordBackup({ at: "2026-10-01T17:30:00Z", archive: "foldrun-data-20261002-0330.tar.gz.age", accounts: ["acme"], kinds: ["files", "database", "keys"], verified: true, offsite: "r2", encrypted: true, recipient: "sha256:0123456789abcdef" });
  const res = await backupsRoute.GET(new NextRequest("http://x/api/account/backups", { headers: auth() }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.backups.map((b: { archive: string }) => b.archive), ["foldrun-data-20261002-0330.tar.gz.age", "foldrun-data-20261001-0330.tar.gz"]);
  assert.equal(body.last.offsite, "r2");
  assert.equal(body.last.encrypted, true);
  assert.equal(body.last.recipient, "sha256:0123456789abcdef");
  assert.equal(body.backups[1].encrypted, false);
  assert.equal(body.policy.encrypted, true);
  assert.ok(body.policy.covers.length > 0);
  assert.equal(body.workspaces[0].name, "desk");
  assert.equal(body.workspaces[0].history, true);
});

test("a restore request is recorded and listed; a viewer cannot ask; bad input is a 400", async () => {
  const ask = (b: object, k = key) => requestsRoute.POST(new NextRequest("http://x/api/account/backups/requests", { method: "POST", headers: auth(k), body: JSON.stringify(b) }));
  assert.equal((await ask({ what: "runs", target: "yesterday" }, viewer)).status, 403);
  assert.equal((await ask({ what: "the lot", target: "yesterday" })).status, 400);
  assert.equal((await ask({ what: "runs" })).status, 400);
  assert.equal((await ask({ what: "runs", target: "x", workspace: "nope" })).status, 404);
  const res = await ask({ what: "runs", workspace: "desk", target: "2026-09-30 09:00", note: "deleted a run" });
  assert.equal(res.status, 201);
  const { request } = await res.json();
  assert.equal(request.notified, false, "no mail credential in tests: recorded, and says it was not mailed");
  const list = await (await requestsRoute.GET(new NextRequest("http://x/api/account/backups/requests", { headers: auth() }))).json();
  assert.equal(list.requests[0].id, request.id);
  assert.equal(list.requests[0].workspace, "desk");
});

test("restore requests are listed only for the workspaces a caller was given; an account-wide one only to an unscoped caller", async () => {
  const ask = (b: object) => requestsRoute.POST(new NextRequest("http://x/api/account/backups/requests", { method: "POST", headers: auth(), body: JSON.stringify(b) }));
  assert.equal((await ask({ what: "runs", workspace: "desk", target: "2026-09-30 10:00" })).status, 201);
  assert.equal((await ask({ what: "everything", target: "2026-09-30 11:00" })).status, 201);
  const { key: scoped } = await createApiKey("acme", "other-only", "o@acme.test", undefined, "admin", ["other"]);
  const { key: deskOnly } = await createApiKey("acme", "desk-only", "d@acme.test", undefined, "admin", ["desk"]);
  const listed = async (k: string) => {
    const a = await (await requestsRoute.GET(new NextRequest("http://x/api/account/backups/requests", { headers: auth(k) }))).json();
    const b = await (await backupsRoute.GET(new NextRequest("http://x/api/account/backups", { headers: auth(k) }))).json();
    assert.deepEqual(a.requests, b.requests);
    return a.requests as { workspace: string | null }[];
  };
  assert.deepEqual(await listed(scoped), [], "another workspace's requests, and the account-wide one, are not listed");
  const desk = await listed(deskOnly);
  assert.ok(desk.length > 0);
  assert.ok(desk.every((r) => r.workspace === "desk"));
  const all = await listed(key);
  assert.ok(all.some((r) => r.workspace === null) && all.some((r) => r.workspace === "desk"));
});

test("a dry run to a point that would fail the deploy checks carries their issues, and the warnings", async () => {
  const { writeWorkspaceFile } = await import("@/lib/store");
  writeWorkspaceFile("acme", "desk", "flows/broken.md", "---\nname: broken\ntrigger: manual\n---\n\n1. [[ghost]] — nobody is called this\n", { by: "a@acme.test" });
  const broken = headSha("acme", "desk")!;
  writeWorkspaceFile("acme", "desk", "flows/broken.md", "---\nname: broken\ntrigger: manual\n---\n\n1. [[writer]] — write it\n", { by: "a@acme.test" });
  assert.notEqual(headSha("acme", "desk"), broken);

  const plan = await (await restore({ to: broken, dryRun: true })).json();
  assert.ok(plan.issues.some((i: { message: string }) => /ghost/.test(i.message)), JSON.stringify(plan.issues));
  assert.ok(Array.isArray(plan.warnings));
  const clean = await (await restore({ to: headSha("acme", "desk")!, dryRun: true })).json();
  assert.deepEqual(clean.issues, []);
});
