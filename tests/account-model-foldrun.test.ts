// /api/account/model, foldrun's models: an account chooses to run on the
// platform's keys for one provider instead of its own. The owner chooses
// (they are billed in credits); a provider the platform cannot serve is
// refused at the choice, not at the first step; a key alone never changes
// the choice; GET says what is offered, at what price, and today's spend.
//
//   node --import ./tests/register.mjs --test tests/account-model-foldrun.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-model-foldrun-"));
process.env.FOLDRUN_EDITION = "hosted";
process.env.FOLDRUN_MODEL_SUPPLY = "1";
process.env.FOLDRUN_MODEL_SUPPLY_PROVIDERS = "anthropic,openai,gemini,deepseek,moonshot";
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
fs.mkdirSync(path.join(process.env.FOLDRUN_DATA, "acme", "workspaces"), { recursive: true });
const { NextRequest } = await import("next/server");
const route = await import("../app/api/account/model/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { setSupplyLeversForTest } = await import("@/platform/settings");
const keys = await import("@/platform/model-keys");
const { resetModelChoicesForTests } = await import("@/platform/model-choice");
const { accountModelSupply } = await import("../server/account-model.ts");
const { edition } = await import("@/platform/ledger");

// foldrun's models are hosted-only, and a build without billing is
// self-hosted whatever the environment says (ledger.ts edition()): there
// these cases skip, and the hosted check (foldrun-admin scripts/check.sh)
// runs them. The last case — nothing offered off the hosted platform —
// runs in both.
const hosted = { skip: edition() === "hosted" ? false : "a build without billing is self-hosted: foldrun's models are not offered (the hosted check runs this)" };

const { key: owner } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
const { key: admin } = await createApiKey("acme", "ci2", "ci2@acme.test", undefined, "admin", null);
const { key: viewer } = await createApiKey("acme", "ro", "ro@acme.test", undefined, "viewer", null);
const h = (k: string) => ({ authorization: `Bearer ${k}`, "content-type": "application/json" });
const get = (k = owner) => route.GET(new NextRequest("http://x/api/account/model", { headers: h(k) }));
const put = (body: object, k = owner) => route.PUT(new NextRequest("http://x/api/account/model", { method: "PUT", headers: h(k), body: JSON.stringify(body) }));

resetModelChoicesForTests();
keys.resetModelKeysForTests();
setSupplyLeversForTest([]);
await keys.setModelKey("anthropic", ["sk", "ant", "platform", "xxxxxxxxxxxxxxxx"].join("-"), "operator:test");

test("GET: offered, which providers are ready and why the others are not, today's spend", hosted, async () => {
  const r = await (await get()).json();
  assert.equal(r.source, "own");
  assert.equal(r.choiceVersion, 0);
  const f = r.foldrunModels;
  assert.equal(f.offered, true);
  assert.equal(f.refused, null);
  const byName = Object.fromEntries(f.providers.map((p: { name: string }) => [p.name, p]));
  assert.equal(byName.anthropic.available, true);
  assert.equal(byName.openai.available, false);
  assert.match(byName.openai.reason, /not available/, "the platform holds no openai key");
  assert.equal(f.spentTodayUsd, 0);
  assert.doesNotMatch(JSON.stringify(r), /platform-xxxx/, "never the platform's key");
});

test("a viewer cannot choose", hosted, async () => {
  assert.equal((await put({ source: "foldrun", supply: "anthropic" }, viewer)).status, 403);
});

test("a provider the platform cannot serve is refused at the choice", hosted, async () => {
  const r = await put({ source: "foldrun", supply: "openai" });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /not available/);
  assert.equal((await put({ source: "foldrun" })).status, 400, "supply is required");
  assert.equal((await put({ source: "theirs" })).status, 400);
});

test("an admin chooses anthropic: runs on foldrun's models; a stale version is a 409", hosted, async () => {
  const r = await put({ source: "foldrun", supply: "anthropic", ifVersion: 0 });
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const b = await r.json();
  assert.deepEqual({ source: b.source, supply: b.supply, runsOn: b.runsOn, v: b.choiceVersion }, { source: "foldrun", supply: "anthropic", runsOn: "foldrun", v: 1 });
  assert.equal(accountModelSupply("acme"), "foldrun", "the banner and onboarding count it as a model");
  assert.equal((await put({ source: "own", ifVersion: 0 })).status, 409);
});

test("a key alone never changes the choice; source own goes back", hosted, async () => {
  const k = await put({ provider: "openrouter", apiKey: ["sk", "or", "v1", "customer", "yyyyyyyy"].join("-") });
  assert.equal(k.status, 200);
  const b = await k.json();
  assert.deepEqual({ source: b.source, set: b.set, runsOn: b.runsOn }, { source: "foldrun", set: true, runsOn: "foldrun" });
  const back = await (await put({ source: "own", ifVersion: 1 }, admin)).json();
  assert.deepEqual({ source: back.source, supply: back.supply, runsOn: back.runsOn }, { source: "own", supply: null, runsOn: "account" });
});

test("a key sent with a stale choice version is not stored either", hosted, async () => {
  const before = (await (await get()).json()).keyHint;
  const r = await put({ provider: "openrouter", apiKey: ["sk", "or", "v1", "other", "zzzzzzzz"].join("-"), source: "own", ifVersion: 0 });
  assert.equal(r.status, 409);
  assert.equal((await (await get()).json()).keyHint, before, "the key is unchanged");
});

test("refused for this account by the operator: GET says why, and the choice is refused", hosted, async () => {
  setSupplyLeversForTest(["acme"]);
  try {
    const r = await (await get()).json();
    assert.match(r.foldrunModels.refused, /not available to this account/);
    assert.equal((await put({ source: "foldrun", supply: "anthropic" })).status, 409);
  } finally {
    setSupplyLeversForTest([]);
  }
});

test("off the hosted platform nothing is offered and nothing can be chosen", async () => {
  process.env.FOLDRUN_EDITION = "self-hosted";
  try {
    const r = await (await get()).json();
    assert.equal(r.foldrunModels.offered, false);
    assert.match(r.foldrunModels.refused, /foldrun's own platform/);
    assert.equal((await put({ source: "foldrun", supply: "anthropic" })).status, 409);
  } finally {
    process.env.FOLDRUN_EDITION = "hosted";
  }
});
