// Own model keys off (models.byok, 22 Nov 2026 — off unless a platform admin
// turns it on): an account cannot store a key of its own or go back to one,
// a stored key is not what the account runs on, and an account AGENTS.md or
// a deploy that names its own provider: is refused.
//
//   node --import ./tests/register.mjs --test tests/byok-off.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

delete process.env.FOLDRUN_BYOK;
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-byok-off-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
const { NextRequest } = await import("next/server");
const route = await import("../app/v1/account/model/route.ts");
const agentsMd = await import("../app/v1/account/agents-md/route.ts");
const deploy = await import("../app/v1/workspaces/[workspace]/deploy/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { registerPlatform, platform } = await import("@/lib/platform");
const { getSecret, setSecret } = await import("@/lib/secrets");
const { ownModelKeysOn } = await import("@/platform/model-choice");

const { key: admin } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
const h = { authorization: `Bearer ${admin}`, "content-type": "application/json" };
const put = (body: object) => route.PUT(new NextRequest("http://x/v1/account/model", { method: "PUT", headers: h, body: JSON.stringify(body) }));
const get = () => route.GET(new NextRequest("http://x/v1/account/model", { headers: h }));

// acme is a customer: not one of the operator's accounts.
// And core's hook as the platform's boot registers it (foldrun-platform
// src/index.ts): the runner, the deploy and the checks ask it.
const prev = { allowed: platform.platformKeyAllowed, own: platform.ownModelKeys };
registerPlatform({ platformKeyAllowed: (t) => t !== "acme", ownModelKeys: () => ownModelKeysOn() });
test.after(() => registerPlatform({ platformKeyAllowed: prev.allowed, ownModelKeys: prev.own }));

test("own keys are off unless a platform admin turns them on", () => {
  assert.equal(ownModelKeysOn(), false);
  process.env.FOLDRUN_BYOK = "1";
  assert.equal(ownModelKeysOn(), true);
  delete process.env.FOLDRUN_BYOK;
});

test("off: storing a key, or going back to one, is refused (403) and nothing is written; GET says so", async () => {
  const stored = await put({ provider: "anthropic", apiKey: "sk-ant-api03-the-customers-own-key-0000" });
  assert.equal(stored.status, 403);
  assert.match((await stored.json()).error, /own model keys are off .*models\.byok/);
  assert.equal(getSecret("acme", "FOLDRUN_MODEL_API_KEY"), null, "nothing stored");
  const back = await put({ source: "own" });
  assert.equal(back.status, 403);
  const view = await (await get()).json();
  assert.equal(view.ownKeys, false);
});

test("off: a key stored while they were on is not what the account runs on, and can still be removed", async () => {
  setSecret("acme", "FOLDRUN_MODEL_PROVIDER", "anthropic");
  setSecret("acme", "FOLDRUN_MODEL_API_KEY", "sk-ant-api03-stored-before-it-was-off-1111");
  const view = await (await get()).json();
  assert.notEqual(view.runsOn, "account");
  const gone = await route.DELETE(new NextRequest("http://x/v1/account/model", { method: "DELETE", headers: h }));
  assert.equal(gone.status, 200);
  assert.equal(getSecret("acme", "FOLDRUN_MODEL_API_KEY"), null);
});

test("off: an account AGENTS.md that names its own provider: is refused (config/own-model-key), and one without it is written", async () => {
  const send = (content: string) => agentsMd.PUT(new NextRequest("http://x/v1/account/agents-md", { method: "PUT", headers: h, body: JSON.stringify({ content }) }));
  const refused = await send("---\nprovider:\n  name: anthropic\n  token: ${MINE}\n---\n\nShared.\n");
  assert.equal(refused.status, 422);
  assert.match((await refused.json()).error, /own models|provider:/);
  assert.equal((await send("---\nnetwork: trusted\n---\n\nShared.\n")).status, 200);
});

test("off: a deploy whose agent names its own provider: is refused, with the file and the rule", async () => {
  fs.mkdirSync(path.join(process.env.FOLDRUN_DATA!, "acme", "workspaces", "desk"), { recursive: true });
  const files = [
    { path: "AGENTS.md", content: "---\nname: desk\n---\n\nA desk.\n" },
    { path: "agents/w/agent.md", content: "---\nname: w\ndescription: works\nprovider:\n  name: openai\n  token: ${MINE}\n---\n\nWork.\n" },
  ];
  const res = await deploy.POST(new NextRequest("http://x/v1/workspaces/desk/deploy", { method: "POST", headers: h, body: JSON.stringify({ files }) }), { params: Promise.resolve({ workspace: "desk" }) });
  assert.equal(res.status, 422, await res.clone().text());
  const body = await res.json();
  assert.ok(body.issues.some((i: { where: string; message: string }) => /^agents\/w\/agent\.md:4$/.test(i.where) && /config\/own-model-key/.test(i.message)), JSON.stringify(body.issues));
});

// An account with no plan and no way to bring a key (the t-nosub account on dev): every place that told it
// to add an API key says it needs a plan instead, and links to Billing → Plans.
test("off, no plan: the dashboard says the account needs a plan, never to add an API key", async () => {
  const { noSupplyStatus } = await import("../components/model-key-status.ts");
  const off = noSupplyStatus(false);
  assert.equal(off.label, "No plan");
  assert.match(off.text, /needs a plan/);
  assert.doesNotMatch(`${off.label} ${off.text}`, /API key|No key/);
  const on = noSupplyStatus(true);
  assert.equal(on.label, "No key");
  assert.match(on.text, /add an API key/);
  // The card links to Billing → Plans (a link inside a message).
  const settings = JSON.parse(fs.readFileSync(new URL("../messages/en/settings.json", import.meta.url), "utf8"));
  assert.match(settings["model-key"].pickAPlan, /<link>Billing → Plans<\/link>/);
  const src = fs.readFileSync(new URL("../app/dashboard/settings/model-key.tsx", import.meta.url), "utf8");
  assert.match(src, /!ownKeys && model\.runsOn === "none"[\s\S]*?href="\/dashboard\/billing\/plans"/);
  // And the banner on every page.
  const layout = fs.readFileSync(new URL("../app/dashboard/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /needsPlan = noModelKey && !ownModelKeysOn\(\)/);
  assert.match(layout, /\{needsPlan && \([\s\S]*?href="\/dashboard\/billing\/plans"|\{needsPlan && \([\s\S]*?\/dashboard\/billing\/plans/);
});

test("off, no plan: the getting-started step is Get a plan, linking to Billing → Plans", async () => {
  const { onboardingFacts } = await import("../server/onboarding.ts");
  const { onboardingSteps } = await import("../components/onboarding-model.ts");
  const facts = await onboardingFacts("acme");
  assert.deepEqual(facts.model, { done: false, needsPlan: true });
  const step = onboardingSteps(facts).steps.find((s) => s.id === "model")!;
  assert.equal(step.href, "/dashboard/billing/plans");
  assert.doesNotMatch(`${step.title} ${step.why}`, /key/i);
  assert.equal(step.cli, undefined, "no CLI command to add a key");
  // Own keys on: the old step.
  process.env.FOLDRUN_BYOK = "1";
  try {
    const on = onboardingSteps(await onboardingFacts("acme")).steps.find((s) => s.id === "model")!;
    assert.match(on.title, /model key/i);
  } finally {
    delete process.env.FOLDRUN_BYOK;
  }
});
