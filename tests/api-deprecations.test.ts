// Usage of the dated API and the warnings before a sunset: the gate counts
// who calls what, Settings → API / GET /api/account/api show it, and an
// account still calling a deprecated route is mailed once per step, the most
// urgent one due, naming the key that calls it.
//
//   node --import ./tests/register.mjs --test tests/api-deprecations.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-api-deprecations-"));
delete process.env.FOLDRUN_DATABASE_URL;

// Fixtures: several accounts, each its own owner — signup stays open for them.
process.env.FOLDRUN_OPEN_SIGNUP = "1";
const { createUser } = await import("../server/users.ts");
const usage = await import("@/platform/api-usage");
const { stepsDue, warnDeprecatedCallers, deprecationNotice } = await import("../server/api-deprecations.ts");
const { apiUsageFacts } = await import("../server/api-facts.ts");

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-13T10:00:00Z");
const dep = (sunsetInDays: number | null) => ({
  method: "DELETE",
  path: /^\/api\/old$/,
  route: "DELETE /api/old",
  deprecatedAt: "2026-09-01",
  ...(sunsetInDays === null ? {} : { sunsetAt: new Date(NOW + sunsetInDays * DAY).toISOString() }),
  link: "https://docs.foldrun.io/api-usage",
});

const fresh = () => {
  usage.resetApiUsageForTests();
  for (const f of [".api-usage.json", ".api-deprecation-notices.json"]) fs.rmSync(path.join(process.env.FOLDRUN_DATA!, f), { force: true });
};

await createUser("owner@dep.test", "correct horse battery staple 9", "dep");
await createUser("owner@quiet.test", "correct horse battery staple 9", "quiet");

test("the steps due: seen always, then 90, 30 and 7 days before the sunset; nothing after it", () => {
  assert.deepEqual(stepsDue(dep(null), NOW), ["seen"]);
  assert.deepEqual(stepsDue(dep(200), NOW), ["seen"]);
  assert.deepEqual(stepsDue(dep(90), NOW), ["seen", "90d"]);
  assert.deepEqual(stepsDue(dep(29), NOW), ["seen", "90d", "30d"]);
  assert.deepEqual(stepsDue(dep(3), NOW), ["seen", "90d", "30d", "7d"]);
  assert.deepEqual(stepsDue(dep(0), NOW), []);
  assert.deepEqual(stepsDue(dep(-5), NOW), []);
});

test("an account still calling a deprecated route is mailed once per step, naming who calls it; a quiet one never", async () => {
  fresh();
  usage.recordApiCall({ tenant: "dep", version: "2026-10-01", route: "DELETE /api/old", credential: 'key "ci" (fr_ab12cd34ef…)', at: new Date(NOW - DAY) });
  usage.recordApiCall({ tenant: "quiet", version: "2026-10-01", at: new Date(NOW - DAY) });
  const mails: { tenant: string; to: string; subject: string; text: string }[] = [];
  const send = async (tenant: string, to: string, subject: string, text: string) => (mails.push({ tenant, to, subject, text }), true);

  assert.equal(await warnDeprecatedCallers(NOW, send, [dep(120)]), 1);
  assert.equal(mails[0].to, "owner@dep.test");
  assert.match(mails[0].subject, /DELETE \/api\/old stops working/);
  assert.match(mails[0].text, /key "ci" \(fr_ab12cd34ef…\): 1 request/);
  assert.match(mails[0].text, /What replaces it: https:\/\/docs\.foldrun\.io\/api-usage/);
  assert.equal(await warnDeprecatedCallers(NOW, send, [dep(120)]), 0, "the same step is not mailed twice");

  // A month later the 90-day step is due: one more mail.
  assert.equal(await warnDeprecatedCallers(NOW, send, [dep(89)]), 1);
  assert.ok(mails.every((m) => m.tenant === "dep"), "the account that never called it hears nothing");
});

test("first seen a week before the sunset: one mail, the week's — not four", async () => {
  fresh();
  usage.recordApiCall({ tenant: "dep", version: "2026-10-01", route: "DELETE /api/old", credential: "key x", at: new Date(NOW - DAY) });
  const mails: string[] = [];
  const send = async (_t: string, _to: string, _s: string, text: string) => (mails.push(text), true);
  assert.equal(await warnDeprecatedCallers(NOW, send, [dep(5)]), 1);
  assert.match(mails[0], /in 5 days/);
  assert.equal(await warnDeprecatedCallers(NOW, send, [dep(5)]), 0, "every step up to now is spent");
});

test("a mail that did not go out is tried again next hour", async () => {
  fresh();
  usage.recordApiCall({ tenant: "dep", version: "2026-10-01", route: "DELETE /api/old", credential: "key x", at: new Date(NOW - DAY) });
  assert.equal(await warnDeprecatedCallers(NOW, async () => false, [dep(60)]), 0);
  let n = 0;
  assert.equal(await warnDeprecatedCallers(NOW, async () => (n++, true), [dep(60)]), 1);
  assert.equal(n, 1);
});

test("Settings → API and GET /api/account/api: usage by version, and a deprecated route with its dates and callers", async () => {
  fresh();
  const now = new Date();
  usage.recordApiCall({ tenant: "dep", version: "2026-10-01", at: now });
  usage.recordApiCall({ tenant: "dep", version: "2026-10-01", route: "DELETE /api/old", credential: 'key "ci" (fr_x…)', at: now });
  const facts = await apiUsageFacts("dep", [dep(60)]);
  assert.equal(facts!.versions[0].requests, 2);
  assert.equal(facts!.deprecated[0].route, "DELETE /api/old");
  assert.equal(facts!.deprecated[0].deprecatedAt, "2026-09-01");
  assert.ok(facts!.deprecated[0].sunsetAt);
  assert.equal(facts!.deprecated[0].callers[0].credential, 'key "ci" (fr_x…)');
});

test("the notice text holds no secret: the key's label and prefix only", () => {
  const { text } = deprecationNotice("dep", dep(30), { route: "DELETE /api/old", requests: 3, lastSeen: new Date(NOW).toISOString(), callers: [{ credential: 'key "ci" (fr_ab12cd34ef…)', requests: 3, lastSeen: new Date(NOW).toISOString() }] }, NOW);
  assert.doesNotMatch(text, /fr_[A-Za-z0-9]{20,}/);
  assert.match(text, /in 30 days/);
});

test("the gate counts every authenticated request, and a deprecated route's by the key that called it", async () => {
  fresh();
  const { NextRequest } = await import("next/server");
  const { createApiKey } = await import("../server/auth.ts");
  const { apiGate, resetApiGateCaches } = await import("../server/api-limits.ts");
  const V = await import("../server/api-version.ts");
  resetApiGateCaches();
  const { key, record } = await createApiKey("dep", "ci-deploy", "owner@dep.test", undefined, "editor");
  const auth = { authorization: `Bearer ${key}` };
  const req = (method: string, p: string, headers: Record<string, string>) => new NextRequest(`http://localhost:3900${p}`, { method, headers });
  V.DEPRECATIONS.push(dep(60));
  try {
    await apiGate(req("GET", "/api/workspaces/w/runs", auth));
    const answered = await apiGate(req("DELETE", "/api/old", auth));
    assert.ok(answered.headers.deprecation, "the route still carries its Deprecation header");
    await apiGate(req("GET", "/api/version", {})); // no credential: not anyone's usage
  } finally {
    V.DEPRECATIONS.pop();
  }
  const u = await usage.apiUsageFor("dep", 30);
  assert.equal(u.versions[0].requests, 2);
  assert.equal(u.versions[0].version, V.CURRENT_API_VERSION);
  assert.deepEqual(u.deprecated.map((d) => [d.route, d.callers[0].credential]), [["DELETE /api/old", `key "ci-deploy" (${record.prefix}…)`]]);
  assert.ok(!u.deprecated[0].callers[0].credential.includes(key), "never the secret");
});
