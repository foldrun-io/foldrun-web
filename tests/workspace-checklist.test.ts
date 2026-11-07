// A workspace's checklist: every item read from what the workspace really
// has (a completed run, a trigger, an owner by the cascade, an eval, a
// notify: by the cascade), hidden per person, shown until done or hidden.
//
//   node --import ./tests/register.mjs --test tests/workspace-checklist.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-checklist-"));
delete process.env.FOLDRUN_DATABASE_URL;
const { workspaceChecklist, isChecklistItemId } = await import("../components/workspace-checklist-model.ts");
const { workspaceChecklistFacts, workspaceChecklistFor, onboardingPrefs } = await import("../server/onboarding.ts");
const { deployWorkspace } = await import("@/lib/deploy");

const none = { workspace: "desk", completedRuns: 0, triggers: 0, owner: null, evals: 0, notify: false };

test("nothing there: five items, none done, each linking into the workspace", () => {
  const c = workspaceChecklist(none);
  assert.deepEqual(c.items.map((i) => i.id), ["run", "trigger", "owner", "eval", "notify"]);
  assert.equal(c.done, 0);
  assert.equal(c.total, 5);
  assert.equal(c.show, true);
  assert.ok(c.items.every((i) => i.href.startsWith("/dashboard/desk/")));
  assert.equal(c.items.find((i) => i.id === "notify")?.href, "/dashboard/desk/settings?tab=policies#observability");
  assert.equal(workspaceChecklist({ ...none, workspace: "a b" }).items[0].href, "/dashboard/a%20b/flows");
});

test("each fact ticks its own item; all done hides the card", () => {
  const c = workspaceChecklist({ ...none, completedRuns: 2, owner: "ana@example.com" });
  assert.deepEqual(c.items.filter((i) => i.done).map((i) => i.id), ["run", "owner"]);
  const all = workspaceChecklist({ ...none, completedRuns: 1, triggers: 1, owner: "x", evals: 1, notify: true });
  assert.equal(all.complete, true);
  assert.equal(all.show, false);
});

test("hidden items and a dismissed card are a person's; the rest still counts", () => {
  const c = workspaceChecklist({ ...none, completedRuns: 1 }, { hidden: ["trigger", "owner", "eval", "notify"] });
  assert.equal(c.show, false, "everything left is hidden");
  assert.equal(c.complete, false);
  assert.equal(c.done, 1);
  assert.equal(workspaceChecklist(none, { dismissed: true }).show, false);
  assert.equal(isChecklistItemId("eval"), true);
  assert.equal(isChecklistItemId("deploy"), false);
});

test("facts from a fixture workspace: the owner and notify: cascade from the account", async () => {
  const made = deployWorkspace("acct", "desk", [
    { path: "AGENTS.md", content: "---\nname: desk\n---\n\nA desk.\n" },
    { path: "agents/writer/agent.md", content: "---\nname: writer\ndescription: writes\n---\n\nWrite.\n" },
    { path: "flows/daily.md", content: "---\nname: daily\ntrigger: schedule\nschedule: \"0 9 * * *\"\n---\n\n1. [[writer]] — write\n" },
    { path: "flows/hand.md", content: "---\nname: hand\n---\n\n1. [[writer]] — write\n" },
  ], { by: "a@b.c", message: "made" });
  assert.equal(made.applied, true, JSON.stringify(made.issues));
  let f = workspaceChecklistFacts("acct", "desk");
  assert.deepEqual(f, { workspace: "desk", completedRuns: 0, triggers: 1, owner: null, evals: 0, notify: false });

  fs.writeFileSync(path.join(process.env.FOLDRUN_DATA!, "acct", "AGENTS.md"), "---\nowner: boss@example.com\nnotify:\n  email: ops@example.com\n---\n\nShared.\n");
  f = workspaceChecklistFacts("acct", "desk");
  assert.equal(f.owner, "boss@example.com", "the account's owner: answers for a workspace that names none");
  assert.equal(f.notify, true, "the account's notify: applies until the workspace sets its own");

  const ws = path.join(process.env.FOLDRUN_DATA!, "acct", "workspaces", "desk");
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk\nowner: ana@example.com\nnotify: {}\n---\n\nA desk.\n");
  f = workspaceChecklistFacts("acct", "desk");
  assert.equal(f.owner, "ana@example.com");
  assert.equal(f.notify, false, "a workspace notify: with no address or URL replaces the account's and tells nobody");

  fs.mkdirSync(path.join(ws, "evals"), { recursive: true });
  fs.writeFileSync(path.join(ws, "evals", "smoke.md"), "---\nname: smoke\nagent: writer\n---\n\n## case\n\ninput: x\nexpect: y\n");
  fs.mkdirSync(path.join(ws, "runs"), { recursive: true });
  fs.writeFileSync(path.join(ws, "runs", "r1.json"), JSON.stringify({ id: "r1", flow: "daily", status: "completed", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), steps: [] }));
  fs.writeFileSync(path.join(ws, "runs", "r2.json"), JSON.stringify({ id: "r2", flow: "daily", status: "failed", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), steps: [] }));
  f = workspaceChecklistFacts("acct", "desk");
  assert.equal(f.evals, 1);
  assert.equal(f.completedRuns, 1, "a failed run is not the proof");

  const prefs = onboardingPrefs({ onboardingChecklists: { desk: { hidden: ["notify", 7], dismissedAt: "2026-11-07T00:00:00Z" }, other: "junk" } });
  assert.deepEqual(prefs.checklists, { desk: { hidden: ["notify"], dismissedAt: "2026-11-07T00:00:00Z" } }, "prefs are read defensively");
  const c = workspaceChecklistFor("acct", "desk", prefs);
  assert.equal(c.dismissed, true);
  assert.equal(c.items.find((i) => i.id === "notify")?.hidden, true);
});

test("the checklist agrees with what really happens: saved inputs are not evals; notify must send failures", () => {
  // Codex review, 7 Nov 2026: a folder of saved run inputs ticked "Add an
  // eval", and notify: for completed runs only ticked "Get told when a run
  // fails" though the sender never sends one.
  const made = deployWorkspace("acct2", "desk2", [
    { path: "AGENTS.md", content: "---\nname: desk2\nnotify:\n  email: ops@example.com\n  events: [completed]\n---\n\nA desk.\n" },
    { path: "agents/writer/agent.md", content: "---\nname: writer\ndescription: writes\n---\n\nWrite.\n" },
    { path: "flows/daily.md", content: "---\nname: daily\n---\n\n1. [[writer]] — write\n" },
    { path: "evals/daily-inputs.md", content: "---\nname: daily-inputs\nflow: daily\ninputs: true\n---\n\n## a\n\ntopic: x\n" },
  ], { by: "a@b.c", message: "made" });
  assert.equal(made.applied, true, JSON.stringify(made.issues));
  let f = workspaceChecklistFacts("acct2", "desk2");
  assert.equal(f.evals, 0, "saved inputs test nothing");
  assert.equal(f.notify, false, "notify: for completed runs only never tells anyone about a failure");

  const ws = path.join(process.env.FOLDRUN_DATA!, "acct2", "workspaces", "desk2");
  fs.writeFileSync(path.join(ws, "AGENTS.md"), "---\nname: desk2\nnotify: ops@example.com\n---\n\nA desk.\n");
  f = workspaceChecklistFacts("acct2", "desk2");
  assert.equal(f.notify, true, "a bare address is a destination with the default events, failures included");
});
