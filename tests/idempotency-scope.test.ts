// Idempotency-Key is remembered per caller, not per account: the stored
// answer is replayed before the route's own permission check, so a key
// shared across credentials handed one member's answer to another — a
// viewer could read back the secret an admin's key mint returned. And the
// "still being answered" claim must not outlive a crashed request by a day.
//
//   node --import ./tests/register.mjs --test tests/idempotency-scope.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-idem-"));
delete process.env.FOLDRUN_REDIS_URL;

const { createApiKey } = await import("../server/auth.ts");
const { idempotent, resetIdempotencyMemory } = await import("../server/idempotency.ts");

const req = (key: string, idem: string, body = "{}", p = "/api/keys") =>
  new NextRequest(`http://localhost:3900${p}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "idempotency-key": idem, "content-type": "application/json" },
    body,
  });

test("another credential of the same account never gets the stored answer", async () => {
  resetIdempotencyMemory();
  const admin = await createApiKey("idem-scope", "admin", undefined, undefined, "admin");
  const viewer = await createApiKey("idem-scope", "viewer", undefined, undefined, "viewer");
  let calls = 0;
  const mint = async () => NextResponse.json({ ok: true, key: `mda_secret_${++calls}` });

  await idempotent(req(admin.key, "shared-k"), mint);
  const other = await idempotent(req(viewer.key, "shared-k"), async () => NextResponse.json({ error: "forbidden" }, { status: 403 }));
  assert.equal(other.headers.get("idempotent-replayed"), null, "the viewer's request is its own");
  assert.equal(other.status, 403, "the route's permission check answers it");
  assert.doesNotMatch(await other.text(), /mda_secret/);

  // The same caller still gets its replay.
  const again = await idempotent(req(admin.key, "shared-k"), mint);
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.equal(calls, 1);
});

test("a secret the route names is not stored, so a replay does not repeat it", async () => {
  resetIdempotencyMemory();
  const admin = await createApiKey("idem-secret", "admin", undefined, undefined, "admin");
  let calls = 0;
  const mint = async () => NextResponse.json({ ok: true, key: `mda_secret_${++calls}`, id: "k1" }, { status: 201 });
  const first = await idempotent(req(admin.key, "mint-1"), mint, { secretFields: ["key"] });
  assert.equal(((await first.json()) as { key: string }).key, "mda_secret_1", "the first answer carries the secret");
  const again = await idempotent(req(admin.key, "mint-1"), mint, { secretFields: ["key"] });
  assert.equal(again.headers.get("idempotent-replayed"), "true");
  assert.equal(again.status, 201);
  const body = (await again.json()) as { key: unknown; id: string };
  assert.equal(body.key, null, "the secret is shown once and never kept");
  assert.equal(body.id, "k1");
  assert.equal(calls, 1, "and no second key is minted");
});

test("the in-flight claim is short and kept alive, so a crash does not block the key for a day", async (t) => {
  resetIdempotencyMemory();
  const admin = await createApiKey("idem-crash", "admin", undefined, undefined, "admin");
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  t.after(() => {
    Date.now = realNow;
  });
  // A request that never answers — the pod died mid-handler.
  void idempotent(req(admin.key, "crash-1"), () => new Promise<Response>(() => {}));
  await new Promise((r) => setImmediate(r));
  const busy = await idempotent(req(admin.key, "crash-1"), async () => NextResponse.json({ ok: true }));
  assert.equal(busy.status, 409, "while it is live, a retry waits");
  offset = 121 * 1000;

  // The dead request's heartbeat no longer runs (a crashed pod), so the
  // claim lapses; simulate by not advancing any timer.
  const later = await idempotent(req(admin.key, "crash-1"), async () => NextResponse.json({ ok: true }));
  assert.equal(later.status, 200, "after the pending TTL the key is free again");
});
