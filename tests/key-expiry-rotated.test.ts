// A rotated key's grace is an end the owner chose a moment ago: it must not
// set off the "your key expires — rotate it" mail.
//
//   node --import ./tests/register.mjs --test tests/key-expiry-rotated.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FOLDRUN_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "foldrun-key-rotated-"));
delete process.env.FOLDRUN_DATABASE_URL;

const { createApiKey, rotateApiKey, listApiKeys } = await import("../server/auth.ts");
const { createAccountBySuperAdmin } = await import("../server/users.ts");
const { warnExpiringKeys } = await import("../server/key-expiry.ts");

test("rotating with a grace does not mail a warning about the old key", async () => {
  await createAccountBySuperAdmin("owner@rot.test", "correct horse battery staple 9", "rot");
  const { record } = await createApiKey("rot", "ci", "owner@rot.test", undefined, "editor");
  const { record: fresh } = await rotateApiKey("rot", record.id, 24 * 3_600_000);
  const sent: string[] = [];
  const n = await warnExpiringKeys(Date.now(), async (_t, _to, subject) => (sent.push(subject), true));
  assert.equal(n, 0, `no warning for the key just replaced (sent: ${sent.join("; ")})`);
  const old = (await listApiKeys("rot")).find((k) => k.id === record.id)!;
  assert.ok(old.expiresAt, "the old key still ends when the grace does");
  assert.ok((await listApiKeys("rot")).some((k) => k.id === fresh.id && !k.expiryWarnedAt), "the new key is warned in its own time");
});
