// With Redis, the claim is `SET NX` and, when that loses, a `GET` of the
// winner's claim. If the winner's claim lapsed (or was released) between the
// two calls the GET finds nothing — and the request must not then run
// unclaimed: a third retry would find the key free, claim it, and the same
// key would be answered twice at once. Per the IETF httpapi Idempotency-Key
// draft, a retry while the original is outstanding gets a 409, never a
// second execution.
//
//   node --import ./tests/register.mjs --test tests/idempotency-redis.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-idem-redis-"));
// A port nothing listens on: the client is replaced below before any call.
process.env.FOLDRUN_REDIS_URL = "redis://127.0.0.1:1";

const { cache } = await import("@/platform/cache");
const { createApiKey } = await import("../server/auth.ts");
const { idempotent } = await import("../server/idempotency.ts");

// A minimal fake Redis on the real singleton, so idempotency.ts sees it.
const client = cache()!;
client.disconnect();
client.on("error", () => {});
const kv = new Map<string, string>();
let afterLostSet: ((k: string) => void) | null = null;
const fake = client as unknown as Record<string, unknown>;
fake.set = async (k: string, v: string, ...args: unknown[]) => {
  if (args.includes("NX") && kv.has(k)) {
    afterLostSet?.(k);
    return null;
  }
  kv.set(k, v);
  return "OK";
};
fake.get = async (k: string) => kv.get(k) ?? null;
fake.expire = async () => 1;
fake.del = async (k: string) => (kv.delete(k) ? 1 : 0);

const req = (key: string, idem: string) =>
  new NextRequest("http://localhost:3900/api/workspaces/w/flows/f/run", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "idempotency-key": idem, "content-type": "application/json" },
    body: "{}",
  });

test("a claim that lapses between SET NX and GET does not let two requests run at once", async () => {
  const admin = await createApiKey("idem-redis", "admin", undefined, undefined, "admin");
  let runs = 0;
  const gates: (() => void)[] = [];
  const handler = () => {
    runs++;
    return new Promise<Response>((r) => gates.push(() => r(NextResponse.json({ ok: true }))));
  };

  // A holds the key and is still running.
  const a = idempotent(req(admin.key, "race-1"), handler);
  await new Promise((r) => setImmediate(r));
  assert.equal(runs, 1);

  // B loses the SET NX; A's claim lapses before B's GET reads it.
  afterLostSet = (k) => {
    afterLostSet = null;
    kv.delete(k);
  };
  const b = idempotent(req(admin.key, "race-1"), handler);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));

  // C arrives while B (if it ran) is still running.
  const c = idempotent(req(admin.key, "race-1"), handler);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  const ranBeforeRelease = runs;
  for (const g of gates) g();
  const [, , cr] = await Promise.all([a, b, c]);
  assert.equal(ranBeforeRelease, 2, "B ran only after taking the claim itself, and C did not run");
  assert.equal(cr.status, 409, "a retry while one is outstanding is told to wait");
});

test("a key that keeps lapsing between SET NX and GET is answered 409, not run unclaimed", async () => {
  const admin = await createApiKey("idem-redis-flicker", "admin", undefined, undefined, "admin");
  // Every SET NX finds a claim; every GET finds it gone.
  let lost = 0;
  const realSet = fake.set as (k: string, v: string, ...a: unknown[]) => Promise<string | null>;
  fake.set = async (k: string, v: string, ...a: unknown[]) => {
    if (a.includes("NX")) {
      lost++;
      return null;
    }
    return realSet(k, v, ...a);
  };
  let ran = 0;
  try {
    const res = await idempotent(req(admin.key, "flicker-1"), async () => (ran++, NextResponse.json({ ok: true })));
    assert.equal(ran, 0, "the handler did not run unclaimed");
    assert.equal(res.status, 409);
    assert.ok(lost >= 2, "it tried to claim again before giving up");
  } finally {
    fake.set = realSet;
  }
});
