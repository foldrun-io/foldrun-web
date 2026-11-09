// A gateway key minted into Postgres: the grant round-trips, the list shows
// it, rotation keeps it, and the web funnel still refuses it.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/gateway-keys-db.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-gateway-keys-db-"));
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

test("a gateway key keeps its limits through the table and a rotation, and opens no /api route", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { NextRequest } = await import("next/server");
  const { createApiKey, rotateApiKey, listApiKeys, resolveTenant } = await import("../server/auth.ts");
  const tenant = `gwdb${Date.now()}`;
  const { key, record } = await createApiKey(tenant, "claude code", undefined, undefined, "viewer", null, { gateway: { capUsd: 20, dailyUsd: 5 } });
  assert.equal(record.purpose, "gateway");
  const row = (await listApiKeys(tenant)).find((k) => k.id === record.id)!;
  assert.deepEqual(row.gateway, { capUsd: 20, dailyUsd: 5 });
  const res = await resolveTenant(new NextRequest("https://app.example.test/api/workspaces", { headers: { authorization: `Bearer ${key}` } }));
  assert.equal(res.tenant, null);
  if (res.tenant === null) assert.ok(res.status === 403 && /gateway key/.test(res.message));
  // The mint route itself, against the table: limits in cents, the URL, the list's spend.
  process.env.FOLDRUN_GATEWAY_URL = "https://gateway.example.test/";
  const keysRoute = (await import("../app/api/keys/route.ts")) as { POST: (req: InstanceType<typeof NextRequest>) => Promise<Response>; GET: (req: InstanceType<typeof NextRequest>) => Promise<Response> };
  const { key: admin } = await createApiKey(tenant, "admin", undefined, undefined, "admin");
  const post = async (body: object) => {
    const r = await keysRoute.POST(new NextRequest("https://app.example.test/api/keys", { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
    return { status: r.status, body: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const ok = await post({ purpose: "gateway", label: "laptop", capUsd: 12.345, dailyUsd: 3 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.capUsd, 12.35);
  assert.equal(ok.body.gatewayUrl, "https://gateway.example.test");
  assert.equal((await post({ purpose: "gateway", capUsd: 0.001 })).status, 400, "a limit that rounds to $0 is refused (Codex review)");
  assert.equal((await post({ purpose: "gateway" })).status, 400, "a limit of its own is required");
  const list = (await (await keysRoute.GET(new NextRequest("https://app.example.test/api/keys", { headers: { authorization: `Bearer ${admin}` } }))).json()) as { keys: { id: string; gateway?: { spentUsd: number; todayUsd: number } }[]; gatewayUrl: string };
  assert.equal(list.gatewayUrl, "https://gateway.example.test");
  assert.deepEqual(list.keys.find((k) => k.id === ok.body.id)!.gateway, { capUsd: 12.35, dailyUsd: 3, spentUsd: 0, todayUsd: 0 });

  const { record: next } = await rotateApiKey(tenant, record.id, 0);
  assert.equal(next.purpose, "gateway");
  assert.deepEqual(next.gateway, { capUsd: 20, dailyUsd: 5 });
});
