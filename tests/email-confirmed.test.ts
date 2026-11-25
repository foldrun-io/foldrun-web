// A login whose address is not confirmed makes no credentials (FOL-317, owner, 25 Nov 2026: "they should be
// blocked, email confirmation is needed"), where the install can send the confirmation; and sign-in and recovery
// mail goes through the install's own sender, never an account's (best practice, owner: "take best practice").
//
//   node --import ./tests/register.mjs --test tests/email-confirmed.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-email-confirmed-"));
process.env.FOLDRUN_SECRET_KEY = "email-confirmed-test-key";
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_OPEN_SIGNUP = "1";
process.env.FOLDRUN_RESEND_API_KEY = "re_install_key";
delete process.env.FOLDRUN_DATABASE_URL;

const { NextRequest } = await import("next/server");
const users = await import("../server/users.ts");
const auth = await import("../server/auth.ts");
const confirmed = await import("../server/email-confirmed.ts");
const email = await import("../server/email.ts");

const PASSWORD = "a long enough password here 1";
let n = 0;
async function person(verified: boolean) {
  const tenant = `ec${Date.now().toString(36)}${n++}`;
  const u = await users.createUser(`owner@${tenant}.test`, PASSWORD, tenant, { request: "free" });
  if (verified) await users.setEmailVerified(u.id);
  return { tenant, u: (await users.findUserById(u.id))! };
}
const refusedUnconfirmed = (err: unknown) => (err as { status?: number; code?: string }).status === 403 && (err as { code?: string }).code === "email_unconfirmed";

test("an unconfirmed login mints no API key (the path every key takes: keys route, foldrun login, gateway, A2A, rotation)", async () => {
  const p = await person(false);
  await assert.rejects(auth.createApiKey(p.tenant, "laptop", p.u.email), refusedUnconfirmed);
  assert.equal((await auth.listApiKeys(p.tenant)).length, 0);
  await users.setEmailVerified(p.u.id);
  const made = await auth.createApiKey(p.tenant, "laptop", p.u.email);
  assert.ok(made.key, "once confirmed, it can");
});

test("an unconfirmed login sends no team invite", async () => {
  const p = await person(false);
  await assert.rejects(users.mintInvite(p.tenant, "editor", { email: "friend@example.test", by: { id: p.u.id, email: p.u.email, role: "owner" } }), refusedUnconfirmed);
  const q = await person(true);
  const inv = await users.mintInvite(q.tenant, "editor", { email: "friend@example.test", by: { id: q.u.id, email: q.u.email, role: "owner" } });
  assert.ok(inv.token);
});

test("an unconfirmed login cannot start two-step sign-in", async () => {
  const p = await person(false);
  const session = await users.mintSession(p.u, "test");
  const setup = await import("../app/v1/auth/mfa/setup/route.ts");
  const r = await setup.POST(new NextRequest("http://x/v1/auth/mfa/setup", { method: "POST", headers: { cookie: `${users.SESSION_COOKIE}=${session.value}`, "content-type": "application/json" }, body: "{}" }));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, "email_unconfirmed");
});

test("an install with no mail can never confirm anyone, so nothing is blocked there", async () => {
  const p = await person(false);
  const key = process.env.FOLDRUN_RESEND_API_KEY;
  delete process.env.FOLDRUN_RESEND_API_KEY;
  try {
    assert.equal(confirmed.mustConfirm(p.u), false);
    assert.ok((await auth.createApiKey(p.tenant, "laptop", p.u.email)).key);
  } finally {
    process.env.FOLDRUN_RESEND_API_KEY = key;
  }
});

test("sign-in and recovery mail uses the install's sender even when the account set its own; the account's only where the install has none", async () => {
  const { setSecret } = await import("@/lib/secrets");
  const p = await person(true);
  setSecret(p.tenant, "RESEND_API_KEY", "re_account_key");
  setSecret(p.tenant, "EMAIL_FROM", "Account <hi@account.test>");
  assert.equal(email.authMail(p.tenant)?.key, "re_install_key", "the account's own key never carries a reset link");
  const key = process.env.FOLDRUN_RESEND_API_KEY;
  delete process.env.FOLDRUN_RESEND_API_KEY;
  try {
    assert.equal(email.authMail(p.tenant)?.key, "re_account_key", "a self-hosted install with no sender of its own");
  } finally {
    process.env.FOLDRUN_RESEND_API_KEY = key;
  }
});

test("hosted policy: confirmation is the install's, an account's own mail secret toggles nothing", async () => {
  const { setSecret } = await import("@/lib/secrets");
  const p = await person(false);
  const key = process.env.FOLDRUN_RESEND_API_KEY;
  delete process.env.FOLDRUN_RESEND_API_KEY;
  try {
    setSecret(p.tenant, "RESEND_API_KEY", "re_account_key");
    assert.equal(confirmed.mustConfirm(p.u), false, "self-host, no sender of its own: an account's key does not turn the hold on");
    process.env.FOLDRUN_REQUIRE_EMAIL_CONFIRMATION = "1";
    assert.equal(confirmed.mustConfirm(p.u), true, "the install may require it explicitly");
  } finally {
    process.env.FOLDRUN_RESEND_API_KEY = key;
    delete process.env.FOLDRUN_REQUIRE_EMAIL_CONFIRMATION;
  }
});

test("the reset that first confirms an address ends what the login made before: keys, invites, second factor; an old file-mode cookie dies", async () => {
  const tokens = await import("../server/auth-tokens.ts");
  const reset = await import("../app/v1/auth/reset/route.ts");
  // A login made before FOL-317 (or while the install held nothing back): never confirmed, holding all of it.
  const p = await person(false);
  const key = process.env.FOLDRUN_RESEND_API_KEY;
  delete process.env.FOLDRUN_RESEND_API_KEY;
  let made, cookie;
  try {
    made = await auth.createApiKey(p.tenant, "theirs", p.u.email);
    await users.mintInvite(p.tenant, "editor", { email: "accomplice@example.test", by: { id: p.u.id, email: p.u.email, role: "owner" } });
    await users.setMfa(p.u.id, { secret: "JBSWY3DPEHPK3PXP", backupHashes: [] });
    cookie = await users.mintSession((await users.findUserById(p.u.id))!, "the first signer");
  } finally {
    process.env.FOLDRUN_RESEND_API_KEY = key;
  }
  const u = (await users.findUserById(p.u.id))!;
  const link = tokens.mintToken("reset", { u: u.id, h: tokens.hashFingerprint(u.hash), e: u.email }, tokens.RESET_TTL_MS);
  // A reset that fails (a weak password) leaves the link unspent; the cleanup has run or not, never half.
  const weak = await reset.POST(new NextRequest("http://x/v1/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: link, password: "short" }) }));
  assert.equal(weak.status, 400);
  const r = await reset.POST(new NextRequest("http://x/v1/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: link, password: "the rightful holder picks this 9" }) }));
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await auth.listApiKeys(p.tenant)).find((k) => k.id === made.record.id)?.revokedAt ? true : false, true, "key revoked");
  assert.equal((await users.listInvites(p.tenant, { scope: null })).length, 0, "invite revoked");
  assert.equal((await users.findUserById(p.u.id))!.mfaSecret, undefined, "their second factor gone");
  assert.equal(await users.verifySession(cookie.value), null, "their file-mode cookie ended with the password");
});

test("hosted by edition, not by the billing switch; an address spelled like a personless key is refused", async () => {
  const { platform } = await import("@/lib/platform");
  const p = await person(false);
  const key = process.env.FOLDRUN_RESEND_API_KEY;
  delete process.env.FOLDRUN_RESEND_API_KEY;
  const edition = platform.edition;
  try {
    (platform as { edition: () => string }).edition = () => "hosted";
    assert.equal(confirmed.mustConfirm(p.u), true, "hosted holds back even with its sender missing");
    assert.equal(email.authMail(p.tenant), null, "and sends no sign-in mail through an account's sender: it fails closed");
  } finally {
    (platform as { edition: unknown }).edition = edition;
    process.env.FOLDRUN_RESEND_API_KEY = key;
  }
  await assert.rejects(users.createUser("key:x@evil.test", PASSWORD, `k${Date.now().toString(36)}`, { request: "free" }), /not an email address/);
});

test("a sweep revokes only what was made before its cutoff: a losing second reset leaves the owner's new key alone", async () => {
  const { revokeProvisional } = await import("../server/provisional.ts");
  const p = await person(true);
  const cutoff = new Date(Date.now() - 1000);
  const fresh = await auth.createApiKey(p.tenant, "made after the winning reset", p.u.email);
  await revokeProvisional(p.u, cutoff);
  assert.equal((await auth.listApiKeys(p.tenant)).find((k) => k.id === fresh.record.id)?.revokedAt ?? null, null);
});
