// A key already rotated is not rotated again — with the database as with
// keys.json (tests/api-key-lifecycle.test.ts covers the file). The second
// rotation used to mint a third key and leave the lost one live.
//
//   FOLDRUN_TEST_DATABASE_URL=postgres://foldrun:test@localhost:55432/foldrun \
//     node --import ./tests/register.mjs --test tests/api-key-rotate-db.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.FOLDRUN_TEST_DATABASE_URL;
const opts = { skip: url ? false : "set FOLDRUN_TEST_DATABASE_URL to run against Postgres" };
process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-key-rotate-db-"));
if (url) {
  const u = new URL(url);
  process.env.FOLDRUN_DATABASE_URL = `${u.protocol}//${u.username}@${u.host}${u.pathname}`;
  process.env.FOLDRUN_DATABASE_PASSWORD = u.password;
  process.env.FOLDRUN_SECRET_KEY ??= "test-install-key";
} else delete process.env.FOLDRUN_DATABASE_URL;

test("rotating a key already replaced is a 409 naming its replacement; two at once mint one", opts, async () => {
  const { migrate } = await import("@/platform/db.ts");
  await migrate();
  const { createApiKey, rotateApiKey, listApiKeys } = await import("../server/auth.ts");
  const tenant = `rotdb${Date.now()}`;
  const { record } = await createApiKey(tenant, "ci", undefined, undefined, "editor");
  const { record: fresh } = await rotateApiKey(tenant, record.id, 3_600_000);
  assert.equal((await listApiKeys(tenant)).find((k) => k.id === record.id)?.replacedBy, fresh.id);
  await assert.rejects(rotateApiKey(tenant, record.id, 3_600_000), (e: Error & { status?: number }) => e.status === 409 && e.message.includes(`already rotated to ${fresh.prefix}`));
  assert.equal((await listApiKeys(tenant)).length, 2, "no third key");

  // Two rotations of the same key at once: one wins, the other is refused
  // and its key never left live.
  const results = await Promise.allSettled([rotateApiKey(tenant, fresh.id, 3_600_000), rotateApiKey(tenant, fresh.id, 3_600_000)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const live = (await listApiKeys(tenant)).filter((k) => !k.revokedAt && !k.replacedBy);
  assert.equal(live.length, 1, "one live, unreplaced key at the end");
});
