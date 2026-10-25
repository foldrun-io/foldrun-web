// Your inbox (server/inbox.ts, GET/POST /api/me/inbox): what waits on one
// person, in three buckets that never mix, and marks that only change that
// person's view.
//
//   node --import ./tests/register.mjs --test tests/inbox.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-inbox-"));
process.env.FOLDRUN_HISTORY = "journal";
delete process.env.FOLDRUN_DEV_NO_AUTH;
const { NextRequest } = await import("next/server");
const { createApiKey } = await import("../server/auth.ts");
const inboxRoute = await import("../app/api/me/inbox/route.ts");
const { inboxFor, markInbox, personOf } = await import("../server/inbox.ts");
const { writeRun } = await import("../../foldrun-core/src/store.ts");
const { updateNotice } = await import("../../foldrun-platform/src/notices.ts");

const ANA = "ana@acme.test";
const BO = "bo@acme.test";
const ws = path.join(process.env.FOLDRUN_DATA!, "acme/workspaces/desk");
fs.mkdirSync(path.join(ws, "flows"), { recursive: true });
fs.mkdirSync(path.join(ws, "agents/writer"), { recursive: true });
fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\n---\n");
fs.writeFileSync(path.join(ws, "agents/writer/agent.md"), "---\nname: writer\n---\n\nWrite.\n");
fs.writeFileSync(path.join(ws, "flows/publish.md"), `---\nname: publish\napprovers: [${ANA}]\n---\n\n1. [[writer]] — Write.\n2!. [[writer]] — Publish.\n`);
fs.writeFileSync(path.join(ws, "flows/owned.md"), `---\nname: owned\nowner: ${ANA}\n---\n\n1!. [[writer]] — Publish.\n`);
fs.writeFileSync(path.join(ws, "flows/other.md"), "---\nname: other\n---\n\n1!. [[writer]] — Publish.\n");

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const parked = (id: string, flow: string, startedBy: string | null = null) =>
  writeRun("acme", "desk", {
    id,
    flow,
    status: "awaiting-approval",
    startedAt: ago(10),
    finishedAt: null,
    startedBy,
    steps: [{ agent: "writer", instruction: "publish it", group: 1, optional: false, status: "awaiting-approval", events: [], result: null, costUsd: 0, waitingSince: ago(5) }],
  } as never);
const finished = (id: string, status: "failed" | "completed", summary: string, startedBy: string | null, finishedMinsAgo = 30) =>
  writeRun("acme", "desk", {
    id,
    flow: "other",
    status,
    startedAt: ago(finishedMinsAgo + 5),
    finishedAt: ago(finishedMinsAgo),
    startedBy,
    summary,
    steps: [{ agent: "writer", instruction: "x", group: 1, optional: false, status: status === "failed" ? "failed" : "completed", events: status === "failed" ? [{ type: "error", text: "boom", at: ago(finishedMinsAgo) }] : [], result: summary, costUsd: 0 }],
  } as never);

parked("run-listed", "publish"); // ana is a named approver → mine
parked("run-owned", "owned"); // ana owns the flow → mine
parked("run-team", "other"); // anyone → team
parked("run-hers", "other", ANA); // ana started it → started (someone else decides)
finished("run-failed", "failed", "", ANA); // ana's failure → started
finished("run-blocked", "completed", "BLOCKED — no login", ANA); // ana's BLOCKED → started
finished("run-good", "completed", "GOOD — done", ANA); // fine → nothing
finished("run-old", "failed", "", ANA, 8 * 24 * 60); // older than a week → nothing
finished("run-bos", "failed", "", BO); // bo's → not ana's started

await updateNotice("acme", "proposal", "desk/prop_aaaaaaaaaa", () => ({
  id: "prop_aaaaaaaaaa", workspace: "desk", eval: "q", by: ANA, createdAt: ago(3), updatedAt: ago(2), status: "ready",
  failures: [{ runId: "run-x", check: "c", detail: "d", at: ago(4) }], jobId: null, reply: "r",
  files: [{ path: "agents/writer/agent.md", content: "x", before: "y", sha256: "s" }], issues: [],
}));

test("the buckets: named approver and owner are mine, your own runs are started, the rest is team", async () => {
  const v = await inboxFor("acme", ANA, null, { role: "editor" });
  const at = (id: string) => v.items.find((i) => i.id === id);
  assert.equal(at("gate:desk/run-listed/0")?.bucket, "mine");
  assert.match(at("gate:desk/run-listed/0")?.why ?? "", /approver/);
  assert.equal(at("gate:desk/run-owned/0")?.bucket, "mine");
  assert.equal(at("gate:desk/run-team/0")?.bucket, "team");
  assert.equal(at("gate:desk/run-hers/0")?.bucket, "started", "a gate on your own run — someone else decides it");
  assert.equal(at("run:desk/run-failed")?.bucket, "started");
  assert.equal(at("run:desk/run-blocked")?.bucket, "started");
  assert.equal(at("run:desk/run-good"), undefined);
  assert.equal(at("run:desk/run-old"), undefined, "a week at most");
  assert.equal(at("run:desk/run-bos"), undefined, "someone else's run is not yours");
  assert.equal(at("proposal:desk/prop_aaaaaaaaaa")?.bucket, "mine", "you asked for it");
  assert.ok(v.items.some((i) => i.kind === "issue"), "the failed runs are an issue too");
  assert.ok(v.counts.mine >= 3 && v.counts.started >= 3 && v.counts.team >= 1, JSON.stringify(v.counts));
});

test("a gate you may not approve is not in your inbox", async () => {
  const v = await inboxFor("acme", BO, null, { role: "editor" });
  assert.equal(v.items.find((i) => i.id === "gate:desk/run-listed/0"), undefined, "approvers: names only ana");
  assert.equal(v.items.find((i) => i.id === "gate:desk/run-team/0")?.bucket, "team");
  assert.equal(v.items.find((i) => i.id === "run:desk/run-bos")?.bucket, "started");
});

test("marks change only your view, and a scope narrows what you see", async () => {
  await markInbox("acme", ANA, ["gate:desk/run-team/0"], "dismiss");
  await markInbox("acme", ANA, ["run:desk/run-failed"], "read");
  const v = await inboxFor("acme", ANA, null, { role: "editor" });
  assert.equal(v.items.find((i) => i.id === "gate:desk/run-team/0")?.dismissed, true);
  assert.equal(v.items.find((i) => i.id === "run:desk/run-failed")?.read, true);
  const bo = await inboxFor("acme", BO, null, { role: "editor" });
  assert.equal(bo.items.find((i) => i.id === "gate:desk/run-team/0")?.dismissed, false, "bo's view is bo's");
  await markInbox("acme", ANA, ["gate:desk/run-team/0"], "restore");
  assert.equal((await inboxFor("acme", ANA, null)).items.find((i) => i.id === "gate:desk/run-team/0")?.dismissed, false);
  assert.equal((await inboxFor("acme", ANA, ["elsewhere"])).items.length, 0, "a key scoped to another workspace sees none of desk");
  await assert.rejects(markInbox("acme", ANA, ["rm -rf"], "read"), /not an inbox item/);
});

test("the route: a key minted by a person reads that person's inbox; one with no person is refused", async () => {
  const { key } = await createApiKey("acme", "ana's cli", ANA, undefined, "editor");
  const { key: orphan } = await createApiKey("acme", "robot", undefined, undefined, "editor");
  const get = (k: string, q = "") => inboxRoute.GET(new NextRequest(`http://x/api/me/inbox${q}`, { headers: { authorization: `Bearer ${k}` } }));
  const res = await get(key);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.person, ANA);
  assert.ok(body.items.every((i: { bucket: string }) => i.bucket !== "team"), "team is asked for, not shown by default");
  const team = await (await get(key, "?bucket=team")).json();
  assert.ok(team.items.length >= 1 && team.items.every((i: { bucket: string }) => i.bucket === "team"));
  assert.equal((await get(key, "?bucket=nope")).status, 400);
  assert.equal((await get(orphan)).status, 400);
  const post = await inboxRoute.POST(new NextRequest("http://x/api/me/inbox", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ id: "run:desk/run-blocked", action: "dismiss" }) }));
  assert.equal(post.status, 200);
  const after = await (await get(key, "?dismissed=1")).json();
  assert.deepEqual(after.items.map((i: { id: string }) => i.id), ["run:desk/run-blocked"]);
  assert.equal(personOf({ kind: "key", name: "key:robot" }), null);
});

test("a viewer named in approvers: does not get the gate as theirs — they cannot decide it", async () => {
  const v = await inboxFor("acme", ANA, null, { role: "viewer" });
  assert.equal(v.items.find((i) => i.id === "gate:desk/run-listed/0"), undefined);
  assert.equal(v.items.find((i) => i.id === "gate:desk/run-hers/0")?.bucket, "started", "their own run's gate stays, as news");
});
