// GET /api/usage's ledger is the account's balance and what it was charged,
// nothing more. The 2026-10-26 API version withdrew the operator's accounting
// view (`providerCostUsd`, `marginUsd`): callers pinned earlier keep the two
// keys as null, a redaction rather than the old values. Exercised the way a
// request meets it: the gate resolves the version (header, account pin, or
// a dashboard session), then the route answers through versionedJson.
//
//   node --import ./tests/register.mjs --test tests/usage-ledger-version.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-usage-ledger-"));

const { createApiKey } = await import("../server/auth.ts");
const { apiGate, resetApiGateCaches } = await import("../server/api-limits.ts");
const V = await import("../server/api-version.ts");
const { updateAdminState } = await import("@/platform/admin");
const { GET } = await import("../app/api/usage/route.ts");

const BASE = "http://localhost:3900";
const PRIVATE = ["providerCostUsd", "marginUsd"];

/** One request through the gate and the route, as the proxy runs them. */
async function usage(headers: Record<string, string>): Promise<{ version: string; ledger: Record<string, unknown> }> {
  const first = new NextRequest(`${BASE}/api/usage`, { headers });
  const gate = await apiGate(first);
  assert.equal(gate.refuse, undefined, "the gate lets it through");
  const res = await GET(new NextRequest(`${BASE}/api/usage`, { headers: { ...headers, ...gate.requestHeaders } }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ledger: Record<string, unknown> };
  return { version: gate.headers["foldrun-version"], ledger: body.ledger };
}

async function account(tenant: string): Promise<string> {
  fs.mkdirSync(path.join(process.env.FOLDRUN_DATA!, tenant, "workspaces/desk"), { recursive: true });
  // A run charged 3 whose tokens cost 2 at list price: if anything forwarded
  // the operator's view, the margin (1) would show.
  fs.writeFileSync(
    path.join(process.env.FOLDRUN_DATA!, tenant, "ledger.jsonl"),
    JSON.stringify({ t: "2026-10-20T00:00:00.000Z", kind: "run", usd: -3, cost: 2, workspace: "desk", runId: "run-1" }) + "\n",
  );
  return (await createApiKey(tenant, "ci", undefined, undefined, "editor")).key;
}

test("the first version stays answerable after the first change: every CLI so far pins it", () => {
  assert.equal(V.FIRST_API_VERSION, "2026-10-01");
  assert.ok(V.releasedVersions().includes("2026-10-01"));
  assert.ok(V.releasedVersions().includes(V.CURRENT_API_VERSION));
  assert.deepEqual(V.parseVersion("2026-10-01"), { version: "2026-10-01" });
  // Even with no changes registered at all, the first is known.
  assert.ok(V.releasedVersions([]).includes("2026-10-01"));
});

test("current version: the ledger is balance and charged, and nothing else", async () => {
  resetApiGateCaches();
  const key = await account("ledger-current");
  const r = await usage({ authorization: `Bearer ${key}` });
  assert.equal(r.version, V.CURRENT_API_VERSION);
  assert.deepEqual(Object.keys(r.ledger).sort(), ["balanceUsd", "chargedUsd"]);
  assert.equal(r.ledger.chargedUsd, 3);
});

test("pinned before 2026-10-26 by header: the two keys come back as null, never the values", async () => {
  resetApiGateCaches();
  const key = await account("ledger-header");
  const r = await usage({ authorization: `Bearer ${key}`, "foldrun-version": "2026-10-01" });
  assert.equal(r.version, "2026-10-01");
  for (const k of PRIVATE) assert.equal(r.ledger[k], null, k);
  assert.equal(r.ledger.chargedUsd, 3);
});

test("pinned before 2026-10-26 by the account's pin: the same redaction", async () => {
  resetApiGateCaches();
  const key = await account("ledger-pin");
  await updateAdminState("ledger-pin", { apiVersion: "2026-10-01" }, "test", "api-version");
  const r = await usage({ authorization: `Bearer ${key}` });
  assert.equal(r.version, "2026-10-01");
  for (const k of PRIVATE) assert.equal(r.ledger[k], null, k);
});

test("a signed-in person on a pinned account gets the current shape", async () => {
  resetApiGateCaches();
  const tenant = "ledger-dash";
  const { createUser, mintSession, SESSION_COOKIE } = await import("../server/users.ts");
  // The person signs up first (the account is theirs), then it gets a line.
  const { value } = await mintSession(await createUser("owner@ledger-dash.test", "a long and unusual passphrase 42!", tenant));
  await account(tenant);
  await updateAdminState(tenant, { apiVersion: "2026-10-01" }, "test", "api-version");
  const r = await usage({ cookie: `${SESSION_COOKIE}=${value}` });
  assert.equal(r.version, V.CURRENT_API_VERSION);
  for (const k of PRIVATE) assert.ok(!(k in r.ledger), k);
});
