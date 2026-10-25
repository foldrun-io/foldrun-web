// Getting started: every step derived from the account's real state, the
// order kept, the next step the first not done; and the route, with a
// person's dismissal kept in their prefs.
//
//   node --import ./tests/register.mjs --test tests/onboarding.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-onboarding-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
const { onboardingSteps } = await import("../components/onboarding-model.ts");
const { onboardingFacts } = await import("../server/onboarding.ts");
const { NextRequest } = await import("next/server");
const { GET, PATCH } = await import("../app/api/me/onboarding/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { createUser, mintSession, SESSION_COOKIE, findUserById } = await import("../server/users.ts");
const { deployWorkspace } = await import("@/lib/deploy");

const { registerPlatform, platform } = await import("@/lib/platform");
const { setSecret } = await import("@/lib/secrets");
const { ACCOUNT_MODEL_SECRETS } = await import("@/lib/model-credential");

const empty = { model: null, workspaces: [], agentAuthored: false, runs: 0, completedRuns: 0, secrets: 0, triggers: 0, members: 1, billing: null, cli: false };

test("a new account: nothing done, the workspace first, billing absent where it is not asked for", () => {
  const o = onboardingSteps(empty);
  assert.equal(o.done, 0);
  assert.equal(o.total, 8);
  assert.equal(o.next?.id, "workspace");
  assert.ok(!o.steps.some((s) => s.id === "billing"));
  assert.equal(o.complete, false);
});

test("billing is a step when the plan asks for one; links point into the first workspace", () => {
  const o = onboardingSteps({ ...empty, workspaces: ["sales"], billing: { done: false } });
  assert.equal(o.total, 9);
  assert.equal(o.done, 1);
  assert.equal(o.next?.id, "agent");
  assert.equal(o.steps.find((s) => s.id === "run")?.href, "/dashboard/sales/flows");
});

test("the next step is the first not done, in order, even when later ones are done", () => {
  const o = onboardingSteps({ ...empty, workspaces: ["a"], agentAuthored: true, runs: 3, completedRuns: 0, secrets: 2, cli: true });
  assert.equal(o.next?.id, "success");
  assert.equal(o.done, 5);
});

test("everything done: complete, no next", () => {
  const o = onboardingSteps({ model: { done: true }, workspaces: ["a"], agentAuthored: true, runs: 1, completedRuns: 1, secrets: 1, triggers: 1, members: 2, billing: { done: true }, cli: true });
  assert.equal(o.complete, true);
  assert.equal(o.next, null);
  assert.equal(o.done, o.total);
});

test("an account that must bring a model key is asked for it first", () => {
  const o = onboardingSteps({ ...empty, model: { done: false } });
  assert.equal(o.total, 9);
  assert.equal(o.steps[0].id, "model");
  assert.equal(o.next?.id, "model");
  assert.equal(o.next?.href, "/dashboard/settings#provider");
  assert.match(o.next?.cli ?? "", /^foldrun account model set /);
  const set = onboardingSteps({ ...empty, model: { done: true } });
  assert.equal(set.next?.id, "workspace");
  assert.equal(set.done, 1);
});

test("the model fact follows what the runner would do: platform, none, own key, account provider block", async () => {
  const prev = platform.platformKeyAllowed;
  registerPlatform({ platformKeyAllowed: (t) => t !== "cust" && t !== "gw" });
  try {
    assert.equal((await onboardingFacts("operator")).model, null, "an account on the platform's credential is not asked");
    assert.deepEqual((await onboardingFacts("cust")).model, { done: false });
    setSecret("cust", ACCOUNT_MODEL_SECRETS.key, "sk-ant-api03-test-key-0000");
    assert.deepEqual((await onboardingFacts("cust")).model, { done: true });
    const dir = path.join(process.env.FOLDRUN_DATA!, "gw");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "---\nprovider:\n  base_url: https://gateway.example.com\n  token: ${GW_TOKEN}\n---\n\nShared.\n");
    assert.deepEqual((await onboardingFacts("gw")).model, { done: true }, "an account-wide provider: block is a key");
  } finally {
    registerPlatform({ platformKeyAllowed: prev });
  }
});

const AGENTS = "---\nname: desk\n---\n\nA desk.\n";
const AGENT = "---\nname: writer\ndescription: writes\n---\n\nWrite.\n";
const FLOW = "---\nname: daily\ntrigger: schedule\nschedule: \"0 9 * * *\"\n---\n\n1. [[writer]] — write\n";

test("facts from a fixture account: workspace, a deployed agent, a schedule, a key, a completed run", async () => {
  const before = await onboardingFacts("fixture");
  assert.deepEqual(before.workspaces, []);
  deployWorkspace("fixture", "desk", [{ path: "AGENTS.md", content: AGENTS }, { path: "agents/writer/agent.md", content: AGENT }], { by: "a@b.c", message: "made" });
  assert.equal((await onboardingFacts("fixture")).agentAuthored, false, "the first revision is the workspace being made, its example agent included");
  deployWorkspace("fixture", "desk", [
    { path: "AGENTS.md", content: AGENTS },
    { path: "agents/writer/agent.md", content: AGENT + "\nAnd edit.\n" },
    { path: "flows/daily.md", content: FLOW },
  ], { by: "a@b.c", message: "an agent" });
  const runDir = path.join(process.env.FOLDRUN_DATA!, "fixture/workspaces/desk/runs");
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "r1.json"), JSON.stringify({ id: "r1", flow: "daily", status: "completed", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), steps: [] }));
  await createApiKey("fixture", "cli · laptop", "a@b.c", undefined, "admin", null);
  const f = await onboardingFacts("fixture");
  assert.deepEqual(f.workspaces, ["desk"]);
  assert.equal(f.agentAuthored, true);
  assert.equal(f.triggers, 1);
  assert.equal(f.cli, true);
  assert.equal(f.runs, 1);
  assert.equal(f.completedRuns, 1);
  assert.equal(f.secrets, 0);
});

test("the route: a key reads the steps; a person hides and brings back the card", async () => {
  const { key } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
  const byKey = await GET(new NextRequest("http://x/api/me/onboarding", { headers: { authorization: `Bearer ${key}` } }));
  assert.equal(byKey.status, 200);
  const body = await byKey.json();
  assert.equal(body.dismissed, false);
  assert.ok(Array.isArray(body.steps) && body.next.id === "workspace");

  const keyPatch = await PATCH(new NextRequest("http://x/api/me/onboarding", { method: "PATCH", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ dismissed: true }) }));
  assert.equal(keyPatch.status, 401, "a key is nobody; hiding is a person's");

  const user = await createUser("owner@acme.test", "Qz8-vmT2-plx9-Wr4k-onb", "acme2");
  const { value } = await mintSession(user);
  const cookie = `${SESSION_COOKIE}=${value}`;
  const patch = (dismissed: unknown) =>
    PATCH(new NextRequest("http://x/api/me/onboarding", { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ dismissed }) }));
  assert.equal((await patch("yes")).status, 400);
  assert.equal((await patch(true)).status, 200);
  assert.ok((await findUserById(user.id))?.prefs?.onboardingDismissedAt);
  const read = await (await GET(new NextRequest("http://x/api/me/onboarding", { headers: { cookie } }))).json();
  assert.equal(read.dismissed, true);
  assert.equal((await patch(false)).status, 200);
  assert.equal((await findUserById(user.id))?.prefs ?? null, null);
});
