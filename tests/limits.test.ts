// The password-bearing routes share one refusal: a key hit too often in a
// window is a 429 with retry-after, and a right answer clears it.
//
//   node --import ./tests/register.mjs --test tests/limits.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { refuseWhenLimited, clearLimit } from "../server/limits.ts";

test("the sixth try passes, the seventh is a 429 that says when, and a clear starts over", async () => {
  const key = `test:${Date.now()}`;
  for (let i = 0; i < 6; i++) assert.equal(await refuseWhenLimited(key, 6, 60), null, `try ${i + 1} is allowed`);
  const refused = await refuseWhenLimited(key, 6, 60);
  assert.ok(refused, "the seventh is refused");
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get("retry-after")) > 0);
  assert.match((await refused.json()).error, /too many attempts/);
  await clearLimit(key);
  assert.equal(await refuseWhenLimited(key, 6, 60), null, "cleared");
});
