// Gateway keys (10 Nov 2026): a key for a coding agent's ANTHROPIC_BASE_URL.
// Minted by an account admin with a limit of its own; it opens the gateway
// door and no /api route.
//
//   node --import ./tests/register.mjs --test tests/gateway-keys.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-gateway-keys-"));
process.env.FOLDRUN_DATA = DATA;
delete process.env.FOLDRUN_DEV_NO_AUTH;
delete process.env.FOLDRUN_DATABASE_URL;
process.env.FOLDRUN_DISABLE_WORKER = "1";
process.env.FOLDRUN_DISABLE_SCHEDULER = "1";

const { NextRequest } = await import("next/server");
const { createApiKey, resolveTenant } = await import("../server/auth.ts");
type Req = InstanceType<typeof NextRequest>;
const keysRoute = (await import("../app/api/keys/route.ts")) as { POST: (req: Req) => Promise<Response> };

const admin = (await createApiKey("acme", "admin", undefined, undefined, "admin")).key;
const scoped = (await createApiKey("acme", "scoped", undefined, undefined, "admin", ["desk"])).key;
const editor = (await createApiKey("acme", "ed", undefined, undefined, "editor")).key;
const json = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json" });
async function mint(by: string, body: Record<string, unknown>) {
  const res = await keysRoute.POST(new NextRequest("https://app.example.test/api/keys", { method: "POST", headers: json(by), body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

test("a gateway key's request is checked before anything is made (and a self-hosted install has no gateway)", async () => {
  const g = { purpose: "gateway", capUsd: 20 };
  assert.equal((await mint(editor, g)).status, 403, "minting needs keys:manage");
  assert.equal((await mint(scoped, g)).status, 403, "it spends the whole account's balance: not a workspace-scoped admin");
  // Without a database nothing is minted: the gateway reads its keys there.
  const fileMode = await mint(admin, g);
  assert.equal(fileMode.status, 400);
  assert.match(fileMode.body.error, /hosted platform/);
  // The rest is refused whatever the database (the body is read first).
  assert.equal((await mint(admin, { purpose: "gateway", role: "admin", capUsd: 20 })).status, 400, "no role: it opens the gateway only");
  assert.equal((await mint(admin, { purpose: "gateway", flows: ["x"], capUsd: 20 })).status, 400);
});

test("a gateway key opens no /api route: the funnel refuses it, whatever it asks for", async () => {
  // Written as the database row the mint makes (this suite runs without one).
  const { key, record } = await createApiKey("acme", "claude code", undefined, undefined, "viewer");
  const file = path.join(DATA, "keys.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>[];
  const row = rows.find((r) => r.id === record.id)!;
  row.purpose = "gateway";
  row.gateway = { capUsd: 20, dailyUsd: null };
  fs.writeFileSync(file, JSON.stringify(rows));
  const res = await resolveTenant(new NextRequest("https://app.example.test/api/workspaces", { headers: { authorization: `Bearer ${key}` } }));
  assert.equal(res.tenant, null);
  assert.ok(!res.tenant && res.status === 403 && /gateway key/.test(res.message));
});
