// One-click unsubscribe without a login, and Profile → Notifications.
//
//   node --import ./tests/register.mjs --test tests/unsubscribe-route.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-unsubscribe-"));
process.env.FOLDRUN_SECRET_KEY ??= "unsubscribe-route-key";
delete process.env.FOLDRUN_DATABASE_URL;
const { NextRequest } = await import("next/server");
const { POST } = await import("../app/api/unsubscribe/route.ts");
const { unsubscribeToken } = await import("../../foldrun-core/src/mail.ts");
const { mailAllowed } = await import("../../foldrun-platform/src/email-preferences.ts");

const post = (token: string | null, init: { form?: Record<string, string> } = {}) =>
  POST(
    new NextRequest(`http://x/api/unsubscribe${token !== null && !init.form ? `?token=${encodeURIComponent(token)}` : ""}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: init.form ? new URLSearchParams(init.form).toString() : "List-Unsubscribe=One-Click",
    }),
  );

test("a mail client's one-click POST turns off that category for that workspace, with no login", async () => {
  const token = unsubscribeToken({ tenant: "acme", email: "ops@example.test", category: "run-alerts", workspace: "desk" });
  const res = await post(token);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, category: "run-alerts", workspace: "desk" });
  assert.equal(await mailAllowed("acme", "ops@example.test", "run-alerts", "desk"), false);
  assert.equal(await mailAllowed("acme", "ops@example.test", "run-alerts", "other"), true);
});

test("the confirmation page's form is sent back to the page, done", async () => {
  const token = unsubscribeToken({ tenant: "acme", email: "me@example.test", category: "low-balance", workspace: null });
  const res = await post(null, { form: { token, from: "page" } });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("location")!, /\/unsubscribe\?token=.+&done=1$/);
  assert.equal(await mailAllowed("acme", "me@example.test", "low-balance", null), false);
});

test("a missing, forged or expired token changes nothing", async () => {
  assert.equal((await post(null)).status, 400);
  const good = unsubscribeToken({ tenant: "acme", email: "x@example.test", category: "approvals", workspace: "desk" });
  assert.equal((await post(good.slice(0, -2) + "zz")).status, 401);
  const old = unsubscribeToken({ tenant: "acme", email: "x@example.test", category: "approvals", workspace: "desk", expiresAt: Date.now() - 1 });
  const res = await post(old);
  assert.equal(res.status, 410);
  assert.match((await res.json()).error, /expired/);
  assert.equal(await mailAllowed("acme", "x@example.test", "approvals", "desk"), true);
});

test("a token for a required category is refused, even signed", async () => {
  const token = unsubscribeToken({ tenant: "acme", email: "x@example.test", category: "security", workspace: null });
  assert.equal((await post(token)).status, 409);
});
