// The rate limit must not stand between a person and signing out, or a
// monitor and the health check: those routes are neither counted nor
// refused, even when the caller's (or the account's) bucket is empty.
//
//   node --import ./tests/register.mjs --test tests/api-gate-exempt.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-gate-exempt-"));
delete process.env.FOLDRUN_REDIS_URL;
delete process.env.FOLDRUN_API_RATE_LIMIT;

const { createApiKey } = await import("../server/auth.ts");
const { createUser, mintSession, SESSION_COOKIE } = await import("../server/users.ts");
const { apiGate, resetApiGateCaches, TIERS, ACCOUNT_MULTIPLE } = await import("../server/api-limits.ts");

const req = (method: string, p: string, headers: Record<string, string>) => new NextRequest(`http://localhost:3900${p}`, { method, headers });

test("health, status and version answer a caller whose read bucket is empty", async () => {
  resetApiGateCaches();
  const { key } = await createApiKey("exempt-r", "ci", undefined, undefined, "editor");
  const auth = { authorization: `Bearer ${key}` };
  for (let i = 0; i < TIERS.free.read; i++) await apiGate(req("GET", "/api/workspaces/w/runs", auth));
  assert.ok((await apiGate(req("GET", "/api/workspaces/w/runs", auth))).refuse, "the bucket is empty");
  for (const p of ["/api/healthz", "/api/status", "/api/status/history", "/api/version"]) {
    assert.equal((await apiGate(req("GET", p, auth))).refuse, undefined, `${p} is not rate limited`);
  }
});

test("signing out works when the account's write bucket is spent", async () => {
  resetApiGateCaches();
  const tenant = "exempt-w";
  const user = await createUser("owner@exempt.test", "a long and unusual passphrase 42!", tenant);
  const { value } = await mintSession(user);
  const cookie = { cookie: `${SESSION_COOKIE}=${value}` };
  const keys = await Promise.all(Array.from({ length: ACCOUNT_MULTIPLE }, (_, i) => createApiKey(tenant, `k${i}`, undefined, undefined, "editor")));
  for (const { key } of keys) for (let i = 0; i < TIERS.free.write; i++) await apiGate(req("POST", "/api/keys", { authorization: `Bearer ${key}` }));
  assert.ok((await apiGate(req("POST", "/api/workspaces/w/deploy", cookie))).refuse, "the account's writes are spent");
  assert.equal((await apiGate(req("POST", "/api/auth/logout", cookie))).refuse, undefined, "sign-out is not refused");
});
