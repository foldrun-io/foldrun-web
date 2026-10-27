// The operator console's surface (27 Oct 2026): what FOLDRUN_SURFACE accepts,
// who may sign in to the console, and that a second-factor challenge only
// finishes a sign-in on the surface that asked for it.
//
//   node --import ./tests/register.mjs --test tests/console-surface.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-surface-"));
process.env.FOLDRUN_SECRET_KEY = "surface-test-key";
process.env.FOLDRUN_SKIP_BREACH_CHECK = "1";
process.env.FOLDRUN_PLATFORM_ACCOUNT = "platform-co";
const { NextRequest } = await import("next/server");
const { surface, adminOrigin } = await import("../server/surface.ts");
const { createAccountBySuperAdmin, setMfa } = await import("../server/users.ts");
const { totp, newSecret } = await import("../server/totp.ts");
const { mintToken, CHALLENGE_TTL_MS } = await import("../server/auth-tokens.ts");
const login = await import("../app/api/auth/login/route.ts");
const verify = await import("../app/api/auth/mfa/verify/route.ts");

const PASSWORD = "a long enough password for this 1";
const asSurface = async <T>(s: string | undefined, fn: () => Promise<T>): Promise<T> => {
  const prev = process.env.FOLDRUN_SURFACE;
  if (s === undefined) delete process.env.FOLDRUN_SURFACE;
  else process.env.FOLDRUN_SURFACE = s;
  try {
    return await fn();
  } finally {
    prev === undefined ? delete process.env.FOLDRUN_SURFACE : (process.env.FOLDRUN_SURFACE = prev);
  }
};
const post = (route: { POST: (r: InstanceType<typeof NextRequest>) => Promise<Response> }, url: string, body: unknown) =>
  route.POST(new NextRequest(`http://x${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const operator = await createAccountBySuperAdmin("op@platform.test", PASSWORD, "platform-co");
const customer = await createAccountBySuperAdmin("owner@customer.test", PASSWORD, "customer-co");
const secret = newSecret();

test("FOLDRUN_SURFACE: app by default, three values, a typo refused", async () => {
  await asSurface(undefined, async () => assert.equal(surface(), "app"));
  for (const s of ["app", "admin", "billing"]) await asSurface(s, async () => assert.equal(surface(), s));
  await asSurface("amdin", async () => assert.throws(() => surface(), /must be app, admin or billing/));
  const prev = process.env.FOLDRUN_ADMIN_URL;
  process.env.FOLDRUN_ADMIN_URL = "https://admin.foldrun.io/console";
  assert.equal(adminOrigin(), "https://admin.foldrun.io");
  process.env.FOLDRUN_ADMIN_URL = "http://admin.foldrun.io";
  assert.equal(adminOrigin(), null, "plain http is not a console address");
  prev === undefined ? delete process.env.FOLDRUN_ADMIN_URL : (process.env.FOLDRUN_ADMIN_URL = prev);
});

test("on the console only the platform's operator signs in, and only with a second factor", async () => {
  await asSurface("admin", async () => {
    const stranger = await post(login, "/api/auth/login", { email: "owner@customer.test", password: PASSWORD });
    assert.equal(stranger.status, 403);
    assert.match((await stranger.json()).error, /platform's operator/);
    const noMfa = await post(login, "/api/auth/login", { email: "op@platform.test", password: PASSWORD });
    assert.equal(noMfa.status, 403);
    assert.match((await noMfa.json()).error, /second factor/);
    await setMfa(operator.id, { secret, backupHashes: [] });
    const ok = await post(login, "/api/auth/login", { email: "op@platform.test", password: PASSWORD });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.mfa, true, "the password bought a challenge, not a session");
    assert.equal(ok.headers.get("set-cookie"), null);
  });
  // The customer app is unchanged: the customer signs in as before.
  await asSurface(undefined, async () => {
    const r = await post(login, "/api/auth/login", { email: "owner@customer.test", password: PASSWORD });
    assert.equal(r.status, 200);
  });
});

test("a challenge from the customer app does not finish a sign-in to the console, nor the other way round", async () => {
  const appChallenge = mintToken("mfa-challenge", { u: operator.id, a: "app" }, CHALLENGE_TTL_MS);
  const oldChallenge = mintToken("mfa-challenge", { u: operator.id }, CHALLENGE_TTL_MS);
  const consoleChallenge = mintToken("mfa-challenge", { u: operator.id, a: "admin" }, CHALLENGE_TTL_MS);
  await asSurface("admin", async () => {
    assert.equal((await post(verify, "/api/auth/mfa/verify", { challenge: appChallenge, code: totp(secret) })).status, 401);
    assert.equal((await post(verify, "/api/auth/mfa/verify", { challenge: oldChallenge, code: totp(secret) })).status, 401, "a challenge with no surface is the app's");
    assert.equal((await post(verify, "/api/auth/mfa/verify", { challenge: consoleChallenge, code: totp(secret) })).status, 200);
  });
  await asSurface(undefined, async () => {
    assert.equal((await post(verify, "/api/auth/mfa/verify", { challenge: consoleChallenge, code: totp(secret) })).status, 401);
  });
});
