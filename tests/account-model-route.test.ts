// /api/account/model: an account brings its own model key. The key is
// stored in the account vault, shown only by its last four characters, and
// a Claude login token is refused for an account not allowed the platform's
// credential. Admin only to change.
//
//   node --import ./tests/register.mjs --test tests/account-model-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-model-route-"));
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
const { NextRequest } = await import("next/server");
const route = await import("../app/api/account/model/route.ts");
const { createApiKey } = await import("../server/auth.ts");
const { registerPlatform, platform } = await import("@/lib/platform");
const { getSecret } = await import("@/lib/secrets");

const { key: admin } = await createApiKey("acme", "ci", "ci@acme.test", undefined, "admin", null);
const { key: viewer } = await createApiKey("acme", "ro", "ro@acme.test", undefined, "viewer", null);
const h = (k: string) => ({ authorization: `Bearer ${k}`, "content-type": "application/json" });
const get = (k = admin) => route.GET(new NextRequest("http://x/api/account/model", { headers: h(k) }));
const put = (body: object, k = admin) => route.PUT(new NextRequest("http://x/api/account/model", { method: "PUT", headers: h(k), body: JSON.stringify(body) }));
const del = (k = admin) => route.DELETE(new NextRequest("http://x/api/account/model", { method: "DELETE", headers: h(k) }));

// acme is a customer: not one of the operator's accounts.
const prev = platform.platformKeyAllowed;
registerPlatform({ platformKeyAllowed: (t) => t !== "acme" });
test.after(() => registerPlatform({ platformKeyAllowed: prev }));

test("a customer with no key: runs are refused until one is set", async () => {
  const r = await (await get()).json();
  assert.deepEqual({ set: r.set, runsOn: r.runsOn, platformKeyAllowed: r.platformKeyAllowed }, { set: false, runsOn: "none", platformKeyAllowed: false });
});

test("a Claude login token is refused; an API key for a preset is stored, shown only by its last four", async () => {
  const login = await put({ provider: "anthropic", apiKey: "sk-ant-oat01-a-login-token-xxxx" });
  assert.equal(login.status, 400);
  assert.match((await login.json()).error, /Claude login token/);
  assert.equal(getSecret("acme", "FOLDRUN_MODEL_API_KEY"), null, "nothing stored");

  const ok = await put({ provider: "openrouter", apiKey: "sk-or-v1-the-customers-key-9876" });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.runsOn, "account");
  assert.equal(body.provider, "openrouter");
  assert.equal(body.baseUrl, "https://openrouter.ai/api");
  assert.equal(body.keyHint, "…9876");
  assert.doesNotMatch(JSON.stringify(body), /the-customers-key/, "the key is never returned");
  assert.equal(getSecret("acme", "FOLDRUN_MODEL_API_KEY")?.value, "sk-or-v1-the-customers-key-9876");
  assert.doesNotMatch(JSON.stringify(await (await get()).json()), /the-customers-key/);
});

test("a custom endpoint needs an https base URL; an unknown preset is named", async () => {
  assert.equal((await put({ provider: "custom", apiKey: "k-123456789" })).status, 400);
  assert.equal((await put({ provider: "custom", apiKey: "k-123456789", baseUrl: "http://plain.example.com/v1" })).status, 400);
  const unknown = await put({ provider: "nope", apiKey: "k-123456789" });
  assert.match((await unknown.json()).error, /unknown provider "nope"/);
  const custom = await put({ provider: "custom", apiKey: "k-123456789", baseUrl: "https://llm.example.com/v1", format: "openai" });
  const b = await custom.json();
  assert.deepEqual({ provider: b.provider, baseUrl: b.baseUrl, format: b.format }, { provider: "custom", baseUrl: "https://llm.example.com/v1", format: "openai" });
});

test("only an admin may change it; anyone in the account may read it", async () => {
  assert.equal((await put({ provider: "anthropic", apiKey: "sk-ant-api03-x-1111" }, viewer)).status, 403);
  assert.equal((await del(viewer)).status, 403);
  assert.equal((await get(viewer)).status, 200);
});

test("DELETE removes it, and the account is back to no key", async () => {
  const r = await (await del()).json();
  assert.equal(r.set, false);
  assert.equal(r.runsOn, "none");
  for (const n of ["FOLDRUN_MODEL_API_KEY", "FOLDRUN_MODEL_PROVIDER", "FOLDRUN_MODEL_BASE_URL", "FOLDRUN_MODEL_FORMAT"]) {
    assert.equal(getSecret("acme", n), null, n);
  }
});

test("an operator's account may store a login token (its own subscription)", async () => {
  registerPlatform({ platformKeyAllowed: () => true });
  try {
    const r = await put({ provider: "anthropic", apiKey: "sk-ant-oat01-operators-own-login" });
    assert.equal(r.status, 200);
  } finally {
    registerPlatform({ platformKeyAllowed: (t) => t !== "acme" });
    await del();
  }
});
