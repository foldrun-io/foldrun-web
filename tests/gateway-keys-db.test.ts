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
// A price list, so a model map has something priced to point at (Part A5).
process.env.FOLDRUN_MODEL_PRICES = JSON.stringify({ "anthropic/claude-opus-5-5": [5, 25, 0.5, 6.25, 64000] });

test("a gateway key keeps its limits through the table and a rotation, and opens no /api route", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { NextRequest } = await import("next/server");
  const { createApiKey, rotateApiKey, listApiKeys, resolveTenant } = await import("../server/auth.ts");
  const tenant = `gwdb${Date.now()}`;
  const { key, record } = await createApiKey(tenant, "claude code", undefined, undefined, "viewer", null, { gateway: { capUsd: 20, dailyUsd: 5 } });
  assert.match(key, /^fr_gw_[0-9a-f]{48}$/, "a gateway key says so (FOL-154)");
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

  // On the operator's Claude login: only for an account the operator allows
  // its credential (FOLDRUN_PLATFORM_KEY_ACCOUNTS here), and with no limit.
  const prevAllowed = process.env.FOLDRUN_PLATFORM_KEY_ACCOUNTS;
  process.env.FOLDRUN_PLATFORM_KEY_ACCOUNTS = "someone-else";
  try {
    const refused = await post({ purpose: "gateway", credential: "login" });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.match(refused.body.error, /no plan a login gateway key can run on/);
    process.env.FOLDRUN_PLATFORM_KEY_ACCOUNTS = tenant;
    assert.equal((await post({ purpose: "gateway", credential: "login", capUsd: 5 })).status, 400, "a login key takes no dollar limit");
    assert.equal((await post({ purpose: "gateway", credential: "other" })).status, 400);
    const login = await post({ purpose: "gateway", credential: "login", label: "mine" });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.credential, "login");
    assert.equal(login.body.plan, "pro", "unsaid: pro");
    assert.equal((await post({ purpose: "gateway", credential: "login", plan: "ultra" })).status, 400, "pro or max");
    const big = await post({ purpose: "gateway", credential: "login", plan: "max", label: "big" });
    assert.equal(big.body.plan, "max");
    const listed = (await (await keysRoute.GET(new NextRequest("https://app.example.test/api/keys", { headers: { authorization: `Bearer ${admin}` } }))).json()) as { keys: { id: string; gateway?: Record<string, unknown> }[] };
    assert.deepEqual(listed.keys.find((k) => k.id === login.body.id)!.gateway, { capUsd: null, dailyUsd: null, credential: "login" }, "no spend: not metered");
  } finally {
    if (prevAllowed === undefined) delete process.env.FOLDRUN_PLATFORM_KEY_ACCOUNTS;
    else process.env.FOLDRUN_PLATFORM_KEY_ACCOUNTS = prevAllowed;
  }

  // The model map (Part A5): set and cleared through PATCH /api/keys/<id>.
  const idRoute = (await import("../app/api/keys/[id]/route.ts")) as { PATCH: (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<{ id: string }> }) => Promise<Response> };
  const patch = async (id: string, body: unknown) => {
    const r2 = await idRoute.PATCH(new NextRequest(`https://app.example.test/api/keys/${id}`, { method: "PATCH", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: r2.status, body: (await r2.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const mapped = await patch(ok.body.id, { models: { opus: "claude-opus-5-5" } });
  // A model map points at foldrun's priced models, which only the hosted
  // build has (billing().modelPrice reads the price list). A build without
  // billing — the public edition GitHub CI tests — has no price list, so the
  // same map is refused; the hosted check (foldrun-admin scripts/check.sh)
  // runs the mapping itself.
  // By the build, not FOLDRUN_EDITION: scripts/check.sh runs the hosted
  // build without that variable set.
  const { billing, freeBilling } = await import("@/platform/billing");
  if (billing() === freeBilling) {
    assert.equal(mapped.status, 400, JSON.stringify(mapped.body));
    assert.match(String(mapped.body.error), /has no price on foldrun's models/);
  } else {
    assert.equal(mapped.status, 200, JSON.stringify(mapped.body));
    const afterMap = (await (await keysRoute.GET(new NextRequest("https://app.example.test/api/keys", { headers: { authorization: `Bearer ${admin}` } }))).json()) as { keys: { id: string; gateway?: { models?: Record<string, string>; capUsd: number | null } }[] };
    const gk = afterMap.keys.find((k) => k.id === ok.body.id)!;
    assert.deepEqual(gk.gateway?.models, { opus: "claude-opus-5-5" });
    assert.equal(gk.gateway?.capUsd, 12.35, "the limits are kept");
  }
  assert.equal((await patch(ok.body.id, { models: { sonnet: "nope/x" } })).status, 400);
  assert.equal((await patch(ok.body.id, { capUsd: 99 })).status, 400, "only models change here");
  assert.equal((await patch(record.id, { models: null })).status, 200, "a gateway key minted directly");
  const plain = (await createApiKey(tenant, "plain", undefined, undefined, "editor")).record;
  assert.equal((await patch(plain.id, { models: null })).status, 400, "not a gateway key");
  assert.equal((await patch(ok.body.id, { models: null })).status, 200);

  const { record: next, key: rotated } = await rotateApiKey(tenant, record.id, 0);
  assert.match(rotated, /^fr_gw_/, "a rotation keeps the kind's prefix");
  assert.equal(next.purpose, "gateway");
  assert.deepEqual(next.gateway, { capUsd: 20, dailyUsd: 5 });
});
