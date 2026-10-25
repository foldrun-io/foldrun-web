// `?limit=abc` used to be an empty list and `?limit=-5` the oldest five.
//
//   node --import ./tests/register.mjs --test tests/query.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { intParam } from "../server/query.ts";

test("intParam: an integer in range, clamped outside it, the default otherwise", () => {
  assert.equal(intParam("20", 50, 1, 500), 20);
  assert.equal(intParam(" 7 ", 50, 1, 500), 7);
  assert.equal(intParam("9999", 50, 1, 500), 500);
  assert.equal(intParam("0", 50, 1, 500), 1);
  assert.equal(intParam("-5", 50, 1, 500), 1, "never a slice from the end");
  assert.equal(intParam("abc", 50, 1, 500), 50);
  assert.equal(intParam("1e3", 50, 1, 500), 50);
  assert.equal(intParam("2.5", 50, 1, 500), 50);
  assert.equal(intParam(null, 50, 1, 500), 50);
  assert.equal(intParam(undefined, 50, 1, 500), 50);
  assert.equal(intParam("", 50, 1, 500), 50);
});
